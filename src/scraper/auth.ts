import puppeteer from "puppeteer";
import type { Browser, Page, Protocol } from "puppeteer";
import { config } from "../config";
import { logger } from "../logger/logger";
import { sleep } from "../utils/utils";
import { urls } from "./constants";

// The session cookie. LinkedIn sets it on this exact domain, odd as the leading dot looks;
// injecting it anywhere else leaves the session unauthenticated.
export const SESSION_COOKIE_NAME = "li_at";
export const SESSION_COOKIE_DOMAIN = ".www.linkedin.com";

// The remember-me cookie, issued only to a sign-in that ticked "Keep me logged in". LinkedIn
// accepts it in place of a password to mint a fresh session, and it outlives li_at by a year.
export const REMEMBER_COOKIE_NAME = "li_rm";
export const REMEMBER_COOKIE_DOMAIN = SESSION_COOKIE_DOMAIN;

// The browser id the remember-me cookie was issued to. LinkedIn reissues a session for the
// matched pair and for nothing less: li_rm alone, or beside a different browser's id, is refused.
export const BROWSER_ID_COOKIE_NAME = "bcookie";
export const BROWSER_ID_COOKIE_DOMAIN = ".linkedin.com";

// Chrome drops a cookie carrying no expiry when the browser closes, which would leave a
// persistent profile holding a session and nothing able to renew it. An injected pair is given
// the same one-year lifetime LinkedIn issues them with.
export const REMEMBER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

// A navigation returns before the response carrying the minted session cookie has settled, so
// the jar is polled rather than read once.
export const SESSION_WAIT_TIMEOUT_MS = 10000;

// LinkedIn routes an interactive sign-in through an email/SMS challenge, so the human is given
// a long budget to complete it.
export const LOGIN_TIMEOUT_MS = 600000;

// The feed is an authenticated route: requesting it with a remember-me cookie present is enough
// for LinkedIn to mint a fresh session. The bare home page does not trigger it.
const FEED_URL = "https://www.linkedin.com/feed/";

// Launch flags that keep automation masked. Removing --enable-automation is what keeps
// navigator.webdriver false, and the blink-features flag suppresses the same signal a second way.
const MASKING_LAUNCH_OPTIONS = {
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", "--lang=en-GB"],
};

const HEADLESS_USER_AGENT_TOKEN = "HeadlessChrome/";
const BROWSER_USER_AGENT_TOKEN = "Chrome/";

/**
 * The three ways a run authenticates. Exactly one mode per config: a lone remember-me half is
 * a validation error, not a silent ignore.
 */
export type AuthConfig =
    | { mode: "interactiveProfile"; userDataDir: string }
    | { mode: "rememberMe"; liRm: string; bcookie: string }
    | { mode: "liAt"; liAt: string };

/**
 * The credentials an interactive sign-in leaves behind, captured for a caller to persist.
 */
export interface ISessionCredentials {
    liAt: string;
    liRm?: string;
    bcookie?: string;
}

/**
 * Resolve the authentication to use, from the explicit config when given, otherwise from the
 * environment following the same precedence as the Python scraper: the remember-me pair wins
 * over a bare li_at. Authentication is mandatory, so an unresolvable config throws.
 * @param {AuthConfig} [auth]
 * @returns {AuthConfig}
 */
export const resolveAuthConfig = (auth?: AuthConfig): AuthConfig => {
    if (auth) {
        return validateAuthConfig(auth);
    }

    if (config.LI_RM_COOKIE && config.LI_BCOOKIE) {
        return { mode: "rememberMe", liRm: config.LI_RM_COOKIE, bcookie: config.LI_BCOOKIE };
    }

    if (config.LI_RM_COOKIE || config.LI_BCOOKIE) {
        throw new Error(
            "LI_RM_COOKIE and LI_BCOOKIE only work as a pair. Set both, or fall back to LI_AT_COOKIE."
        );
    }

    if (config.LI_AT_COOKIE) {
        return { mode: "liAt", liAt: config.LI_AT_COOKIE };
    }

    throw new Error(
        "No authentication available. Provide an auth config (interactiveProfile, rememberMe or liAt), " +
        "or set LI_RM_COOKIE with LI_BCOOKIE, or LI_AT_COOKIE."
    );
};

/**
 * Reject a config whose discriminated mode is not backed by the values it requires.
 * @param {AuthConfig} auth
 * @returns {AuthConfig}
 */
const validateAuthConfig = (auth: AuthConfig): AuthConfig => {
    switch (auth.mode) {
        case "interactiveProfile":
            if (!auth.userDataDir) {
                throw new Error("auth mode 'interactiveProfile' requires a non-empty userDataDir.");
            }
            break;
        case "rememberMe":
            if (!auth.liRm || !auth.bcookie) {
                throw new Error("auth mode 'rememberMe' requires both liRm and bcookie.");
            }
            break;
        case "liAt":
            if (!auth.liAt) {
                throw new Error("auth mode 'liAt' requires a non-empty liAt.");
            }
            break;
    }

    return auth;
};

/**
 * Replace the headless User-Agent token and re-issue coherent client hints, so the first
 * authenticated request does not advertise automation. Applied before any authenticated
 * navigation; masking is load-bearing even for interactive login.
 * @param {Page} page
 * @returns {Promise<void>}
 */
export const maskUserAgent = async (page: Page): Promise<void> => {
    const rawUserAgent = await page.browser().userAgent();
    const maskedUserAgent = rawUserAgent.replace(HEADLESS_USER_AGENT_TOKEN, BROWSER_USER_AGENT_TOKEN);

    // High-entropy client hints, read from the live browser so Sec-CH-UA stays coherent with the
    // overridden UA. Unavailable in some engines, in which case the UA string is masked on its own.
    const metadata = await page.evaluate(async (): Promise<Protocol.Emulation.UserAgentMetadata | null> => {
        interface IHighEntropyValues {
            architecture?: string;
            bitness?: string;
            model?: string;
            platformVersion?: string;
            fullVersionList?: { brand: string; version: string }[];
        }

        interface IUserAgentData {
            brands: { brand: string; version: string }[];
            mobile: boolean;
            platform: string;
            getHighEntropyValues: (hints: string[]) => Promise<IHighEntropyValues>;
        }

        // navigator.userAgentData is not in the DOM lib types, so its shape is asserted by a guard
        // after the value has been read as unknown.
        const isUserAgentData = (value: unknown): value is IUserAgentData => {
            if (typeof value !== "object" || value === null) {
                return false;
            }

            if (!("getHighEntropyValues" in value)) {
                return false;
            }

            return typeof value.getHighEntropyValues === "function";
        };

        if (!("userAgentData" in navigator)) {
            return null;
        }

        const candidate: unknown = navigator.userAgentData;

        if (!isUserAgentData(candidate)) {
            return null;
        }

        const uaData = candidate;

        const high = await uaData.getHighEntropyValues([
            "architecture",
            "bitness",
            "model",
            "platformVersion",
            "fullVersionList",
        ]);

        return {
            brands: uaData.brands.map(b => ({ brand: b.brand, version: b.version })),
            fullVersionList: (high.fullVersionList ?? []).map(b => ({ brand: b.brand, version: b.version })),
            platform: uaData.platform,
            platformVersion: high.platformVersion ?? "",
            architecture: high.architecture ?? "",
            model: high.model ?? "",
            mobile: uaData.mobile,
            bitness: high.bitness ?? "",
        };
    });

    if (metadata) {
        await page.setUserAgent(maskedUserAgent, metadata);
    } else {
        await page.setUserAgent(maskedUserAgent);
    }
};

/**
 * Read the session cookie the browser currently holds.
 * @param {Browser} browser
 * @returns {Promise<string | undefined>}
 */
export const getSessionCookie = async (browser: Browser): Promise<string | undefined> => {
    const cookies = await browser.cookies();
    return cookies.find(cookie => cookie.name === SESSION_COOKIE_NAME)?.value;
};

/**
 * Poll the jar until a session cookie appears, or the timeout elapses.
 * @param {Browser} browser
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
export const waitForSession = async (
    browser: Browser,
    timeoutMs: number = SESSION_WAIT_TIMEOUT_MS,
): Promise<string | null> => {
    const pollingTime = 200;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const liAt = await getSessionCookie(browser);

        if (liAt) {
            return liAt;
        }

        await sleep(pollingTime);
    }

    return null;
};

/**
 * Return true when the browser is showing a LinkedIn document. Everything about a session is
 * read from the jar of the page on screen, so an error page or a 429 tells nothing until this
 * is true.
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
export const isOnLinkedin = async (page: Page): Promise<boolean> => {
    try {
        const hostname = await page.evaluate(() => document.location.hostname);
        return !!hostname && hostname.endsWith("linkedin.com");
    } catch (err) {
        return false;
    }
};

/**
 * Return true when the document on screen was served with HTTP 429. LinkedIn answers a run
 * going too fast this way; the status survives on the navigation timing entry even after Chrome
 * replaces the empty body with its own error page.
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
export const isThrottled = async (page: Page): Promise<boolean> => {
    try {
        const status = await page.evaluate((): number | null => {
            const entry = performance.getEntriesByType("navigation")[0];

            if (!entry || !("responseStatus" in entry)) {
                return null;
            }

            // responseStatus is not yet in the DOM lib types; the `in` check narrows it to unknown.
            const responseStatus: unknown = entry.responseStatus;

            return typeof responseStatus === "number" ? responseStatus : null;
        });

        return status === 429;
    } catch (err) {
        return false;
    }
};

/**
 * Return true when the rendered page is the logged-out one. A cookie sitting in the jar does not
 * mean LinkedIn honoured it, so the rendered markers are what tell authenticated from guest apart.
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
export const isGuestPage = async (page: Page): Promise<boolean> => {
    const appShell = ".scaffold-layout, .global-nav";
    const guestMarkers =
        ".authwall, #artdeco-global-alert-container .artdeco-global-alert--eu-cookie-consent, " +
        ".guest-homepage, form.login__form, .base-serp-page";

    try {
        return await page.evaluate(
            (appShellSelector, guestSelector) =>
                !document.querySelector(appShellSelector) && !!document.querySelector(guestSelector),
            appShell,
            guestMarkers,
        );
    } catch (err) {
        return false;
    }
};

/**
 * Return true when the browser is on LinkedIn but the session is no longer honoured, taking care
 * to keep a throttle from looking like a lost session: a 429 leaves an empty jar that would
 * otherwise read as a retired cookie, and re-authenticating over it would spend a working
 * credential on a moment of load shedding.
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
export const isSessionInvalid = async (page: Page): Promise<boolean> => {
    if (!(await isOnLinkedin(page))) {
        return false;
    }

    if (await isThrottled(page)) {
        return false;
    }

    const authenticated = (await getSessionCookie(page.browser())) !== undefined;

    if (!authenticated) {
        return true;
    }

    return await isGuestPage(page);
};

/**
 * Inject the remember-me pair, given a one-year lifetime so a persistent profile keeps it and can
 * renew its own session after the environment that supplied it is gone.
 * @param {Browser} browser
 * @param {string} liRm
 * @param {string} bcookie
 * @returns {Promise<void>}
 */
const injectRememberMeCookies = async (browser: Browser, liRm: string, bcookie: string): Promise<void> => {
    const expires = Math.floor(Date.now() / 1000) + REMEMBER_COOKIE_MAX_AGE_SECONDS;

    await browser.setCookie(
        {
            name: REMEMBER_COOKIE_NAME,
            value: liRm,
            domain: REMEMBER_COOKIE_DOMAIN,
            path: "/",
            secure: true,
            httpOnly: true,
            expires,
        },
        {
            name: BROWSER_ID_COOKIE_NAME,
            value: bcookie,
            domain: BROWSER_ID_COOKIE_DOMAIN,
            path: "/",
            secure: true,
            httpOnly: true,
            expires,
        },
    );
};

/**
 * Inject a bare session cookie as supplied. It cannot be renewed once LinkedIn retires it.
 * @param {Browser} browser
 * @param {string} liAt
 * @returns {Promise<void>}
 */
const injectSessionCookie = async (browser: Browser, liAt: string): Promise<void> => {
    await browser.setCookie({
        name: SESSION_COOKIE_NAME,
        value: liAt,
        domain: SESSION_COOKIE_DOMAIN,
    });
};

/**
 * Ask LinkedIn to reissue a session from the remember-me cookie by requesting the feed and
 * polling the jar for the minted cookie.
 * @param {Browser} browser
 * @param {Page} page
 * @param {string} tag
 * @returns {Promise<string | null>}
 */
const mintSession = async (browser: Browser, page: Page, tag: string): Promise<string | null> => {
    logger.info(tag, "Asking LinkedIn to issue a session from the remember-me cookie");

    try {
        await page.goto(FEED_URL, { waitUntil: "load" });
    } catch (err) {
        logger.warn(tag, "Failed to open the feed while recovering the session");
        return null;
    }

    const liAt = await waitForSession(browser);

    if (liAt) {
        logger.info(tag, "Session issued by LinkedIn");
    } else {
        logger.debug(tag, "LinkedIn did not issue a session");
    }

    return liAt;
};

/**
 * Get a session into the browser for the configured mode, minting a fresh one where possible.
 *
 * A remember-me pair, or a profile that already carries one from an interactive sign-in, has a
 * session reissued so the run starts on one LinkedIn just minted; a bare li_at is handed over as
 * is. Returns the session cookie in effect, or null when none could be established.
 *
 * The browser must already be on a LinkedIn page: cookies can only be injected for the domain of
 * the document on screen.
 * @param {Browser} browser
 * @param {Page} page
 * @param {AuthConfig} authConfig
 * @param {string} tag
 * @returns {Promise<string | null>}
 */
export const authenticate = async (
    browser: Browser,
    page: Page,
    authConfig: AuthConfig,
    tag: string,
): Promise<string | null> => {
    const cookies = await browser.cookies();
    const hasRememberMe = cookies.some(cookie => cookie.name === REMEMBER_COOKIE_NAME);

    switch (authConfig.mode) {
        case "interactiveProfile": {
            // A profile session already in the jar wins over any reissue: use it as is.
            const existing = await getSessionCookie(browser);

            if (existing) {
                return existing;
            }

            // A profile that signed in interactively carries its own remember-me pair and can
            // have a session reissued from it.
            if (hasRememberMe) {
                return await mintSession(browser, page, tag);
            }

            logger.error(
                tag,
                "The profile holds no session and no remember-me cookie. Sign in once with an " +
                "interactive login before scraping with this profile."
            );
            return null;
        }

        case "rememberMe": {
            // Never overwrite a profile's own pair; only inject when the jar has none.
            if (!hasRememberMe) {
                logger.info(tag, "Setting remember-me cookies");
                await injectRememberMeCookies(browser, authConfig.liRm, authConfig.bcookie);
            }

            return await mintSession(browser, page, tag);
        }

        case "liAt": {
            logger.info(tag, "Setting authentication cookie");
            await injectSessionCookie(browser, authConfig.liAt);
            return (await getSessionCookie(browser)) ?? null;
        }
    }
};

/**
 * Sign in interactively into a persistent Chrome profile and return the credentials it captured.
 *
 * Launches a visible browser on the profile and returns at once if it already holds a session;
 * otherwise waits for the human to sign in, detecting success by the li_at cookie appearing
 * rather than by the url leaving the sign-in page, because LinkedIn routes through an email/SMS
 * challenge. Persisting the returned credentials is the caller's job.
 * @param {string} userDataDir
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<ISessionCredentials>}
 */
export const ensureSession = async (
    userDataDir: string,
    opts?: { timeoutMs?: number },
): Promise<ISessionCredentials> => {
    if (!userDataDir) {
        throw new Error("ensureSession requires a userDataDir to sign in into.");
    }

    const timeoutMs = opts?.timeoutMs ?? LOGIN_TIMEOUT_MS;

    let browser: Browser;

    try {
        browser = await puppeteer.launch({
            headless: false,
            userDataDir,
            ...MASKING_LAUNCH_OPTIONS,
        });
    } catch (err) {
        throw new Error(
            `Failed to open a browser on profile '${userDataDir}'. It may be in use by another ` +
            `Chrome process: only one browser can use a profile at a time.`
        );
    }

    try {
        const page = await browser.newPage();
        await maskUserAgent(page);
        await page.goto(urls.home, { waitUntil: "load" });

        // Already signed in: nothing to wait for.
        let liAt = await getSessionCookie(browser);

        if (!liAt) {
            await page.goto("https://www.linkedin.com/login", { waitUntil: "load" });
            logger.info("Waiting for interactive sign-in. Tick 'Keep me logged in' so the profile can self-renew.");

            const found = await waitForSession(browser, timeoutMs);

            if (!found) {
                throw new Error(
                    `Interactive login did not establish a session within ${Math.round(timeoutMs / 1000)}s.`
                );
            }

            liAt = found;
        }

        const cookies = await browser.cookies();
        const liRm = cookies.find(cookie => cookie.name === REMEMBER_COOKIE_NAME)?.value;
        const bcookie = cookies.find(cookie => cookie.name === BROWSER_ID_COOKIE_NAME)?.value;

        return { liAt, liRm, bcookie };
    } finally {
        // Chrome locks the profile directory, so the browser must be fully closed before a scrape
        // reuses the same profile.
        await browser.close();
    }
};
