import { RunStrategy, IRunStrategyResult, ILoadResult } from "./RunStrategy";
import { Browser, Page, CDPSession } from "puppeteer";
import { events, IData, IMetrics } from "../events";
import { sleep } from "../../utils/utils";
import { normalizeString, cleanApplicantCount } from "../../utils/string";
import { parseRelativeDate } from "../../utils/dates";
import { IQuery } from "../query";
import { Scraper } from "../Scraper";
import {
    AuthConfig,
    authenticate,
    isSessionInvalid,
    isThrottled,
    maskUserAgent,
    SESSION_COOKIE_NAME,
} from "../auth";
import { InvalidCookieException } from "../exceptions";
import { logger } from "../../logger/logger";
import {
    urls,
    JOB_ID_ATTRIBUTE,
    PAGINATION_SIZE,
    MAX_RESULTS_CEILING,
    PAGINATION_RETRY_DELAY,
    THROTTLED_STATUS,
    THROTTLE_BACKOFF_DELAYS,
    THROTTLE_BACKOFF_JITTER,
    LIST_SETTLE_TIMEOUT,
    LIST_SETTLE_QUIET_PERIOD,
    LIST_SETTLE_POLL_INTERVAL,
    LOAD_MORE_JOBS_POLL_INTERVAL,
    LOAD_MORE_JOBS_TIMEOUT,
    LOAD_JOB_CARD_TIMEOUT,
    LOAD_JOB_CARD_POLL_INTERVAL,
    MISSING_ITEM_GRACE,
    CONTAINER_WAIT_TIMEOUT,
    CONTAINER_WAIT_POLL_INTERVAL,
} from "../constants";
import debug from "debug";

// How many times a lost session is rebuilt before the run is aborted, scoped per location.
const MAX_SESSION_RECOVERIES = 2;

// A standalone /jobs/view/<id> page is obfuscated, so a single job is opened inside a search
// context: the currentJobId url param renders the full detail panel on its own, while a throwaway
// keywords value satisfies the search route
const SCRAPE_JOB_SEARCH_KEYWORDS = "engineer";

// Time budget for the single-job detail panel to render and settle
const SINGLE_JOB_PANEL_TIMEOUT = 15000;

// The description length must stay unchanged for this long before the panel is considered settled
const SINGLE_JOB_PANEL_QUIET_PERIOD = 1000;

export const selectors = {
    container: '.scaffold-layout__list',
    chatPanel: '.msg-overlay-list-bubble',
    jobs: 'div.job-card-container',
    jobItems: `.scaffold-layout__list li[${JOB_ID_ATTRIBUTE}]`,
    link: 'a.job-card-container__link',
    applyBtn: 'button.jobs-apply-button[role="link"]',
    title: '.artdeco-entity-lockup__title',
    company: '.artdeco-entity-lockup__subtitle',
    panelTitle: '.job-details-jobs-unified-top-card__job-title',
    panelCompany: '.job-details-jobs-unified-top-card__company-name',
    companyLink: '.job-details-jobs-unified-top-card__company-name a',
    companyEmployeeCount: '.jobs-company__box .jobs-company__inline-information',
    place: '.artdeco-entity-lockup__caption',
    date: 'time',
    dateText: '.job-details-jobs-unified-top-card__primary-description-container span:nth-of-type(3)',
    resultsCountStandalone: '.jobs-search-results-list__subtitle small, small.jobs-search-results-list__text',
    resultsCountTitle: 'span#results-list__title',
    description: '.jobs-description',
    detailsPanel: '.jobs-search__job-details--container',
    detailsTop: '.jobs-details-top-card',
    details: '.jobs-details__main-content',
    insights: '.job-details-fit-level-preferences button',
    fitLevelButtons: '.job-details-fit-level-preferences button',
    salaryRailCard: '.jobs-details__salary-main-rail-card',
    applyButton: 'button.jobs-apply-button',
    tertiaryDescription: '.job-details-jobs-unified-top-card__tertiary-description-container',
    benefits: '.featured-benefits__benefit',
    pagination: '.jobs-search-two-pane__pagination',
    privacyAcceptBtn: 'button.artdeco-global-alert__action',
    paginationNextBtn: 'li[data-test-pagination-page-btn].selected + li',
    paginationBtn: (index: number) => `li[data-test-pagination-page-btn="${index}"] button`,
};

/**
 * Build the selector addressing a single item of the results list by its job id
 * @param {string} jobId
 * @returns {string}
 */
const getJobItemSelector = (jobId: string): string =>
    `${selectors.container} li[${JOB_ID_ATTRIBUTE}="${jobId}"]`;

/**
 * Return a wait, in seconds, drawn around a step of the backoff ladder
 * @param {number} base the step of the ladder
 * @returns {number}
 */
const jitteredBackoff = (base: number): number =>
    base * (1 - THROTTLE_BACKOFF_JITTER + Math.random() * 2 * THROTTLE_BACKOFF_JITTER);

interface IOpenResult {
    success: boolean;
    throttled: boolean; // Whether the last attempt came back throttled (HTTP 429)
}

interface ILoadCardResult {
    success: boolean;
    missing: boolean; // Whether the item has left the results list, rather than failed to render
    error?: string;
}

/**
 * Card-derived and contextual fields fed to the shared detail extractor. The extractor reads the
 * panel/document-scoped fields itself; these are the fields whose source differs between a search
 * card and a single-job panel.
 */
interface IExtractJobDataParams {
    query: string;
    location: string;
    jobId: string;
    jobIndex: number;
    link: string;
    title: string;
    company: string;
    place: string;
    date: string; // ISO date from the card <time>, or "" to fall back to the relative date text
    companyImgLink?: string;
    applyLink: boolean; // Whether to capture the external apply link
    descriptionFn?: () => string;
    tag: string;
}

/**
 * @class AuthenticatedStrategy
 * @extends RunStrategy
 */
export class AuthenticatedStrategy extends RunStrategy {
    private _authConfig: AuthConfig;

    // The session cookie in effect right after the first authenticate completed. A run whose
    // ending cookie differs from this rotated its session, which the scraper reports so a caller
    // can persist the new value.
    private _initialLiAt: string | undefined = undefined;

    /**
     * @constructor
     * @param {Scraper} scraper
     * @param {AuthConfig} authConfig
     */
    constructor(scraper: Scraper, authConfig: AuthConfig) {
        super(scraper);
        this._authConfig = authConfig;
    }

    /**
     * The session cookie established at the start of the run, or undefined before authentication.
     * @returns {string | undefined}
     */
    public get initialLiAt(): string | undefined {
        return this._initialLiAt;
    }

    /**
     * Check if session is authenticated
     * @param {Page} page
     * @returns {Promise<boolean>}
     * @static
     * @private
     */
    private static _isAuthenticatedSession = async (page: Page): Promise<boolean> => {
        const cookies = await page.browser().cookies();
        return cookies.some(e => e.name === SESSION_COOKIE_NAME);
    };

    /**
     * Rebuild the session and re-open the results page. The jar is emptied of its session first,
     * so a persistent profile's retired cookie cannot keep winning over the credentials about to
     * be supplied.
     * @param {Browser} browser
     * @param {Page} page
     * @param {string} url
     * @param {string} tag
     * @returns {Promise<boolean>} true if the results container rendered
     */
    private _reopenResults = async (
        browser: Browser,
        page: Page,
        url: string,
        tag: string,
    ): Promise<boolean> => {
        const staleSessionCookies = (await browser.cookies())
            .filter(cookie => cookie.name === SESSION_COOKIE_NAME);

        if (staleSessionCookies.length) {
            try {
                await browser.deleteCookie(...staleSessionCookies);
            }
            catch (err) {}
        }

        await page.goto(urls.home, { waitUntil: 'load' });

        const liAt = await authenticate(browser, page, this._authConfig, tag);

        if (!liAt) {
            return false;
        }

        await page.goto(url, { waitUntil: 'load' });

        try {
            await page.waitForSelector(selectors.container, { timeout: 5000 });
            return true;
        }
        catch (err) {
            return false;
        }
    };

    /**
     * Return the ids of every job in the current results page, in display order
     * @param {Page} page
     * @returns {Promise<string[]>}
     * @static
     * @private
     */
    private static _getJobIds = async (page: Page): Promise<string[]> => {
        try {
            const jobIds = await page.evaluate(
                (itemsSelector: string, attribute: string) =>
                    Array.from(document.querySelectorAll(itemsSelector))
                        .map(e => e.getAttribute(attribute))
                        .filter((e): e is string => Boolean(e)),
                selectors.jobItems,
                JOB_ID_ATTRIBUTE,
            );

            return jobIds ?? [];
        }
        catch (err) {
            // page.evaluate rejects while the document is being replaced
            return [];
        }
    };

    /**
     * Return the ids of the results list once it has stopped changing
     *
     * The first render of a page is not the page: LinkedIn paints a preliminary list and
     * replaces it about a second later with the real one, and the two do not hold the same jobs.
     * A full batch is what the list has to reach before holding still is believed; short of that
     * only the timeout can tell a render still on its way from the last page of results.
     *
     * @param {Page} page
     * @param {number} timeout seconds
     * @param {number} quietPeriod seconds the list has to hold still to count as settled
     * @returns {Promise<string[]>}
     * @static
     * @private
     */
    private static _waitForStableJobIds = async (
        page: Page,
        timeout: number = LIST_SETTLE_TIMEOUT,
        quietPeriod: number = LIST_SETTLE_QUIET_PERIOD,
    ): Promise<string[]> => {
        const sleepTime = LIST_SETTLE_POLL_INTERVAL;
        let elapsed = 0;
        let quiet = 0;
        let jobIds: string[] = [];

        while (elapsed < timeout) {
            const current = await AuthenticatedStrategy._getJobIds(page);

            if (current.length && AuthenticatedStrategy._sameIds(current, jobIds)) {
                quiet += sleepTime;

                if (quiet >= quietPeriod && jobIds.length >= PAGINATION_SIZE) {
                    return jobIds;
                }
            }
            else {
                quiet = 0;
                jobIds = current;
            }

            await sleep(sleepTime * 1000);
            elapsed += sleepTime;
        }

        // A short list here is the last page of results, and an empty one a page holding none:
        // both are the caller's to report
        return jobIds;
    };

    /**
     * Return whether two id lists hold the same ids in the same order
     * @param {string[]} a
     * @param {string[]} b
     * @returns {boolean}
     * @static
     * @private
     */
    private static _sameIds = (a: string[], b: string[]): boolean =>
        a.length === b.length && a.every((id, index) => id === b[index]);

    /**
     * Try to make LinkedIn append more items to the results list
     *
     * The list is filled in progressively as it is scrolled, so the number of items a page holds
     * is not known upfront and has to be grown until it stops changing.
     *
     * @param {Page} page
     * @param {number} jobCount
     * @param {number} timeout seconds
     * @returns {Promise<boolean>}
     * @static
     * @private
     */
    private static _loadMoreJobs = async (
        page: Page,
        jobCount: number,
        timeout: number = LOAD_MORE_JOBS_TIMEOUT,
    ): Promise<boolean> => {
        const sleepTime = LOAD_MORE_JOBS_POLL_INTERVAL;
        let elapsed = 0;

        while (elapsed < timeout) {
            let count: number | null;

            try {
                count = await page.evaluate(
                    (itemsSelector: string, knownCount: number) => {
                        const items = document.querySelectorAll(itemsSelector);

                        // Scrolling the last known item into view is what makes LinkedIn append
                        // the next batch
                        if (items.length && items.length <= knownCount) {
                            items[items.length - 1].scrollIntoView({ block: 'end' });
                        }

                        return items.length;
                    },
                    selectors.jobItems,
                    jobCount,
                );
            }
            catch (err) {
                count = null;
            }

            if (count !== null && count > jobCount) {
                return true;
            }

            await sleep(sleepTime * 1000);
            elapsed += sleepTime;
        }

        return false;
    };

    /**
     * Wait for the card of a job to be rendered, scrolling it into view
     *
     * The results list is virtualized: only the items close to the viewport hold a rendered
     * card, so an item must be brought into view before any of its fields can be read. An item
     * that is not in the list at all is a different answer, and the caller is told so: LinkedIn
     * re-renders the list while the loop walks it, and an id read from a render that no longer
     * exists is not a job that failed to load.
     *
     * @param {Page} page
     * @param {string} jobId
     * @param {number} timeout seconds
     * @returns {Promise<ILoadCardResult>}
     * @static
     * @private
     */
    private static _loadJobCard = async (
        page: Page,
        jobId: string,
        timeout: number = LOAD_JOB_CARD_TIMEOUT,
    ): Promise<ILoadCardResult> => {
        const sleepTime = LOAD_JOB_CARD_POLL_INTERVAL;
        let elapsed = 0;
        let missingFor = 0;

        while (elapsed < timeout) {
            let state: string | null;

            try {
                state = await page.evaluate(
                    (itemSelector: string, cardSelector: string) => {
                        const item = document.querySelector(itemSelector);

                        if (!item) {
                            return 'missing';
                        }

                        if (item.querySelector(cardSelector)) {
                            return 'rendered';
                        }

                        item.scrollIntoView({ block: 'center' });
                        return 'pending';
                    },
                    getJobItemSelector(jobId),
                    selectors.jobs,
                );
            }
            catch (err) {
                // page.evaluate rejects while the document is being replaced
                state = null;
            }

            if (state === 'rendered') {
                return { success: true, missing: false };
            }

            if (state === 'missing') {
                missingFor += sleepTime;

                if (missingFor >= MISSING_ITEM_GRACE) {
                    break;
                }
            }
            else {
                missingFor = 0;
            }

            await sleep(sleepTime * 1000);
            elapsed += sleepTime;
        }

        if (missingFor >= MISSING_ITEM_GRACE) {
            return { success: false, missing: true, error: `Job ${jobId} is no longer in the results list` };
        }

        return { success: false, missing: false, error: `Timeout on rendering job card ${jobId}` };
    };

    /**
     * Wait for the results list to be rendered
     * @param {Page} page
     * @param {number} timeout seconds
     * @returns {Promise<boolean>}
     * @static
     * @private
     */
    private static _waitForContainer = async (
        page: Page,
        timeout: number = CONTAINER_WAIT_TIMEOUT,
    ): Promise<boolean> => {
        try {
            await page.waitForSelector(selectors.container, { timeout: timeout * 1000 });
            return true;
        }
        catch (err) {
            return false;
        }
    };

    /**
     * Wait for the results list to hold at least one item
     * @param {Page} page
     * @param {string} tag
     * @param {number} timeout seconds
     * @returns {Promise<boolean>}
     * @static
     * @private
     */
    private static _waitForJobItems = async (
        page: Page,
        tag: string,
        timeout: number = CONTAINER_WAIT_TIMEOUT,
    ): Promise<boolean> => {
        const sleepTime = CONTAINER_WAIT_POLL_INTERVAL;
        let elapsed = 0;

        logger.debug(tag, 'Waiting for new jobs to load');

        while (elapsed < timeout) {
            let items: number | null;

            try {
                items = await page.evaluate(
                    (itemsSelector: string) => document.querySelectorAll(itemsSelector).length,
                    selectors.jobItems,
                );
            }
            catch (err) {
                // The document is replaced while the next page loads
                items = null;
            }

            if (items) {
                return true;
            }

            await sleep(sleepTime * 1000);
            elapsed += sleepTime;
        }

        return false;
    };

    /**
     * Return LinkedIn's approximate total result count, or -1 when it cannot be parsed
     *
     * The count sits either in a standalone element of the results header ("204,000+ results")
     * or, combined with the query, in the results title span. A standalone count is preferred and
     * the title is the fallback. It is matched by shape rather than by position, so a header
     * carrying no count simply yields -1.
     *
     * @param {Page} page
     * @returns {Promise<number>}
     * @static
     * @private
     */
    private static _readJobTotal = async (page: Page): Promise<number> => {
        let raw: string;

        try {
            raw = await page.evaluate(
                (titleSelector: string, countSelector: string) => {
                    const pattern = /([\d,]+\+?)\s*results/i;

                    // Prefer a standalone count element, then any small element in the header
                    const candidates = Array.from(document.querySelectorAll<HTMLElement>(countSelector))
                        .concat(Array.from(document.querySelectorAll<HTMLElement>('small')));

                    for (const el of candidates) {
                        const match = (el.innerText || el.textContent || '').match(pattern);
                        if (match) {
                            return match[1];
                        }
                    }

                    // Fall back to the combined title
                    const title = document.querySelector<HTMLElement>(titleSelector);

                    if (title) {
                        const match = (title.innerText || title.textContent || '').match(pattern);
                        if (match) {
                            return match[1];
                        }
                    }

                    return '';
                },
                selectors.resultsCountTitle,
                selectors.resultsCountStandalone,
            );
        }
        catch (err) {
            return -1;
        }

        if (!raw) {
            return -1;
        }

        const parsed = parseInt(raw.replace(/,/g, '').replace(/\+/g, '').trim(), 10);
        return Number.isNaN(parsed) ? -1 : parsed;
    };

    /**
     * Try to load job details
     * @param {Page} page
     * @param {string} jobId
     * @param {number} timeout
     * @static
     * @private
     */
    private static _loadJobDetails = async (
        page: Page,
        jobId: string,
        timeout: number = 2000,
    ): Promise<ILoadResult> => {
        const pollingTime = 50;
        let elapsed = 0;
        let loaded = false;

        await sleep(pollingTime);

        try {
            while (elapsed < timeout) {
                loaded = await page.evaluate(
                    (jobId, panelSelector, descriptionSelector) => {
                        const detailsPanel = document.querySelector(panelSelector) as HTMLElement;
                        const description = document.querySelector(descriptionSelector) as HTMLElement;
                        return detailsPanel && detailsPanel.innerHTML.includes(jobId) &&
                            description && description.innerText.length > 0;
                    },
                    jobId,
                    selectors.detailsPanel,
                    selectors.description,
                );

                if (loaded) {
                    return { success: true };
                }

                await sleep(pollingTime);
                elapsed += pollingTime;
            }
        }
        catch (err) {}

        return {
            success: false,
            error: `Timeout on loading job details`
        };
    };

    /**
     * Hide chat panel
     * @param {Page} page
     * @param {string} tag
     */
    private static _hideChatPanel = async (
        page: Page,
        tag: string,
    ): Promise<void> => {
        try {
            await page.evaluate((selector) => {
                    const div = document.querySelector(selector) as HTMLElement;
                    if (div) {
                        div.style.display = "none";
                    }
                },
                selectors.chatPanel);
        }
        catch (err) {
            logger.debug(tag, "Failed to hide chat panel");
        }
    };

    /**
     * Accept cookies
     * @param {Page} page
     * @param {string} tag
     */
    private static _acceptCookies = async (
        page: Page,
        tag: string,
    ): Promise<void> => {
        try {
            await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const cookieButton = buttons.find(e => e.innerText.includes('Accept cookies'));

                if (cookieButton) {
                    cookieButton.click();
                }
            });
        }
        catch (err) {
            logger.debug(tag, "Failed to accept cookies");
        }
    };

    /**
     * Accept privacy
     * @param page
     * @param tag
     */
    private static _acceptPrivacy = async (
        page: Page,
        tag: string,
    ): Promise<void> => {
        try {
            await page.evaluate((selector) => {
                const privacyButton = Array.from(document.querySelectorAll<HTMLElement>(selector))
                    .find(e => e.innerText === 'Accept');

                if (privacyButton) {
                    privacyButton.click();
                }
            }, selectors.privacyAcceptBtn);
        }
        catch (err) {
            logger.debug(tag, "Failed to accept privacy");
        }
    };

    /**
     * Try extracting apply link
     * @param {Page} page
     * @param {CDPSession} cdpSession
     * @param {string} tag
     * @param {number} timeout
     * @returns {Promise<{ success: boolean, url?: string, error?: string | Error }>}
     */
    private static _extractApplyLink = async (
        page: Page,
        cdpSession: CDPSession,
        tag: string,
        timeout = 4,
    ): Promise<{ success: boolean, url?: string, error?: string | Error }> => {
        try {
            logger.debug(tag, 'Try extracting apply link');
            const currentUrl = page.url();
            const elapsed = 0;
            const sleepTimeMs = 100;

            if (await page.evaluate((applyBtnSelector: string) => {
                const applyBtn = document.querySelector(applyBtnSelector) as HTMLButtonElement;

                if (applyBtn) {
                    applyBtn.click();
                    return true;
                }

                return false;
            }, selectors.applyBtn)) {

                while (elapsed < timeout) {
                    const targetsResponse = await cdpSession.send('Target.getTargets');

                    // The first target of type page with a valid url different from main page should be our guy
                    if (targetsResponse.targetInfos && targetsResponse.targetInfos.length > 1) {
                        for (const targetInfo of targetsResponse.targetInfos) {
                            if (targetInfo.attached && targetInfo.type === 'page' && targetInfo.url && targetInfo.url !== currentUrl) {
                                await cdpSession.send('Target.closeTarget', { targetId: targetInfo.targetId });
                                return { success: true, url: targetInfo.url };
                            }
                        }
                    }

                    await sleep(sleepTimeMs);
                }

                return { success: false, error: 'timeout' };
            }
            else {
                return { success: false, error: 'apply button not found' };
            }
        }
        catch (err: any) {
            logger.warn(tag, 'Failed to extract apply link', err);
            return { success: false, error: err };
        }
    };

    /**
     * Read every detail-panel field of the currently open job and assemble the emitted payload.
     * Shared by the search loop and by scrapeJob: the caller supplies the card-derived and
     * contextual fields, and everything panel/document-scoped is read here.
     * @param {Page} page
     * @param {CDPSession} cdpSession
     * @param {IExtractJobDataParams} params
     * @returns {Promise<IData>}
     * @static
     * @private
     */
    private static _extractJobData = async (
        page: Page,
        cdpSession: CDPSession,
        params: IExtractJobDataParams,
    ): Promise<IData> => {
        const { tag } = params;
        let jobDate = params.date;
        let jobDescription: string;
        let jobDescriptionHTML: string;

        // Use custom description function if available
        logger.debug(tag, 'Evaluating selectors', [
            selectors.description,
        ]);

        if (params.descriptionFn) {
            const [customDescription, descriptionHTML] = await Promise.all([
                page.evaluate(`(${params.descriptionFn.toString()})();`),
                page.evaluate((selector) => {
                    return (<HTMLElement>document.querySelector(selector)).outerHTML;
                }, selectors.description)
            ]);

            jobDescription = customDescription as string;
            jobDescriptionHTML = descriptionHTML;
        }
        else {
            [jobDescription, jobDescriptionHTML] = await page.evaluate((selector) => {
                    const el = (<HTMLElement>document.querySelector(selector));
                    return [el.innerText, el.outerHTML];
                },
                selectors.description
            );
        }

        // Extract date text (eg '1 week ago')
        const jobDateText = await page.evaluate((selector) => {
            const el = document.querySelector(selector) as HTMLElement | null;

            if (el) {
                return el.innerText;
            }
            else {
                return '';
            }
        }, selectors.dateText);

        // A reposted listing is flagged in the date text; the card's <time>
        // datetime is authoritative when present, otherwise the ISO date is
        // approximated from the relative date text
        const jobReposted = /reposted/i.test(jobDateText);

        if (!jobDate) {
            jobDate = parseRelativeDate(jobDateText, new Date());
        }

        // Extract company link
        const jobCompanyLink = await page.evaluate((selector) => {
            const el = document.querySelector(selector);

            if (el) {
                return el.getAttribute("href") || '';
            }
            else {
                return '';
            }
        }, selectors.companyLink);

        // Extract company employee count
        logger.debug(tag, 'Evaluating selectors', [
            selectors.companyEmployeeCount,
        ]);

        const jobCompanyEmployeeCount = await page.evaluate((selector: string) => {
            const spans = Array.from(document.querySelectorAll<HTMLElement>(selector));
            const el = spans.find(e => /employee/i.test(e.innerText));

            if (el) {
                return el.innerText.split(' employees')[0].replace(/,/g, '').trim();
            }

            return '';
        }, selectors.companyEmployeeCount);

        // Extract salary, easy-apply flag, applicant count and benefits
        logger.debug(tag, 'Evaluating selectors', [
            selectors.fitLevelButtons,
            selectors.salaryRailCard,
            selectors.applyButton,
            selectors.tertiaryDescription,
            selectors.benefits,
        ]);

        const [salary, isEasyApply, applicantCount, benefits] = await page.evaluate((
            fitLevelSelector: string,
            salaryRailSelector: string,
            applyButtonSelector: string,
            tertiarySelector: string,
            benefitsSelector: string,
        ): [string, boolean, string, string[]] => {
            const moneyRe = /(\$|€|£|₹)\s?\d|\/(yr|hr)\b|per (year|hour)|K\/(yr|hr)/i;

            // Prefer the first fit-level button when it reads as money, else the salary rail card
            const fit = Array.from(document.querySelectorAll<HTMLElement>(fitLevelSelector))
                .map(b => b.innerText.trim())
                .filter(Boolean);
            let salary = (fit[0] && moneyRe.test(fit[0])) ? fit[0] : '';

            if (!salary) {
                const card = document.querySelector<HTMLElement>(salaryRailSelector);

                if (card) {
                    const m = card.innerText.match(/[^\n]*(?:\$|€|£|₹)[^\n]*/);
                    if (m) salary = m[0].trim();
                }
            }

            // Easy Apply keeps the applicant on LinkedIn; the aria-label/text
            // discriminates it from an external apply button
            const applyBtn = document.querySelector<HTMLElement>(applyButtonSelector);
            const isEasyApply = !!applyBtn &&
                /easy apply/i.test(((applyBtn.getAttribute('aria-label') || '') + ' ' + (applyBtn.innerText || '')));

            // The tertiary container reads "<place> · <date> · <applicants>", any
            // segment may be absent, so the applicant segment is matched by shape
            // rather than by position
            let applicantCount = '';
            const tertiary = document.querySelector<HTMLElement>(tertiarySelector);

            if (tertiary) {
                const segments = tertiary.innerText
                    .split('·')
                    .map(e => e.replace(/[\n\r\t ]+/g, ' ').trim())
                    .filter(e => e.length);

                applicantCount = segments.find(e => /applicant|clicked apply/i.test(e)) || '';
            }

            const benefits = Array.from(document.querySelectorAll<HTMLElement>(benefitsSelector))
                .map(e => (e.textContent || '').trim())
                .filter(Boolean);

            return [salary, isEasyApply, applicantCount, benefits];
        },
            selectors.fitLevelButtons,
            selectors.salaryRailCard,
            selectors.applyButton,
            selectors.tertiaryDescription,
            selectors.benefits,
        );

        const jobSalary = normalizeString(salary);
        const jobApplicantCount = cleanApplicantCount(applicantCount);
        const jobBenefits = benefits;

        // Extract job insights
        logger.debug(tag, 'Evaluating selectors', [
            selectors.insights,
        ]);

        const jobInsights = await page.evaluate((jobInsightsSelector: string) => {
            const nodes = document.querySelectorAll(jobInsightsSelector);
            return Array.from(nodes).map(e => e.textContent!
                .replace(/[\n\r\t ]+/g, ' ').trim());
        }, selectors.insights);

        // Apply link
        let jobApplyLink;

        if (params.applyLink) {
            const applyLinkRes = await AuthenticatedStrategy._extractApplyLink(page, cdpSession, tag);

            if (applyLinkRes.success) {
                jobApplyLink = applyLinkRes.url as string;
            }
        }

        return {
            query: params.query,
            location: params.location,
            jobId: params.jobId,
            jobIndex: params.jobIndex,
            link: params.link,
            applyLink: jobApplyLink,
            title: normalizeString(params.title),
            company: normalizeString(params.company),
            companyLink: jobCompanyLink,
            companyEmployeeCount: jobCompanyEmployeeCount || undefined,
            companyImgLink: params.companyImgLink,
            place: normalizeString(params.place),
            description: jobDescription,
            descriptionHTML: jobDescriptionHTML,
            date: jobDate,
            dateText: jobDateText,
            insights: jobInsights,
            salary: jobSalary || undefined,
            isEasyApply: isEasyApply,
            applicantCount: jobApplicantCount || undefined,
            benefits: jobBenefits.length ? jobBenefits : undefined,
            reposted: jobReposted,
        };
    };

    /**
     * Wait for the detail panel of a single job opened by its currentJobId to render and settle.
     * The panel first paints an "About the job" placeholder, so readiness requires the requested
     * job's title to be present and its description length to stop growing.
     * @param {Page} page
     * @param {string} jobId
     * @param {number} timeout
     * @returns {Promise<boolean>}
     * @static
     * @private
     */
    private static _waitForJobPanel = async (
        page: Page,
        jobId: string,
        timeout: number = SINGLE_JOB_PANEL_TIMEOUT,
    ): Promise<boolean> => {
        const pollingTime = 50;
        let elapsed = 0;
        let stableFor = 0;
        let lastLength = -1;

        while (elapsed < timeout) {
            let state: { hasId: boolean; hasTitle: boolean; length: number } | null;

            try {
                state = await page.evaluate(
                    (jobId: string, panelSelector: string, titleSelector: string, descriptionSelector: string) => {
                        const panel = document.querySelector(panelSelector);
                        const titleEl = document.querySelector(titleSelector) as HTMLElement | null;
                        const descEl = document.querySelector(descriptionSelector) as HTMLElement | null;

                        const hasId = panel ? panel.innerHTML.includes(jobId) : false;
                        const title = titleEl
                            ? (titleEl.innerText.split('\n').map(e => e.trim()).find(e => e.length) || "")
                            : "";
                        const length = descEl ? descEl.innerText.length : 0;

                        return { hasId: hasId, hasTitle: title.length > 0, length: length };
                    },
                    jobId,
                    selectors.detailsPanel,
                    selectors.panelTitle,
                    selectors.description,
                );
            }
            catch (err) {
                // page.evaluate rejects while the document is being replaced
                state = null;
            }

            if (state && state.hasId && state.hasTitle && state.length > 0) {
                if (state.length === lastLength) {
                    stableFor += pollingTime;

                    if (stableFor >= SINGLE_JOB_PANEL_QUIET_PERIOD) {
                        return true;
                    }
                }
                else {
                    stableFor = 0;
                }

                lastLength = state.length;
            }
            else {
                stableFor = 0;
                lastLength = -1;
            }

            await sleep(pollingTime);
            elapsed += pollingTime;
        }

        return false;
    };

    /**
     * Report a refusal to the pacer, saying so when it makes the run slower
     * @param {string} tag
     * @private
     */
    private _slowDown = (tag: string): void => {
        const pacer = this.scraper.pacer;
        const before = pacer.delay;
        const after = pacer.throttled();

        if (after > before) {
            logger.warn(tag, `LinkedIn is throttling this run, slowing to ${Math.round(after * 100) / 100}s between jobs`);
        }
    };

    /**
     * Report a unit of work nobody refused, saying so when it makes the run faster
     * @param {string} tag
     * @private
     */
    private _speedUp = (tag: string): void => {
        const pacer = this.scraper.pacer;
        const before = pacer.delay;
        const after = pacer.clean();

        if (after < before) {
            logger.info(tag, `No refusals for a while, easing to ${Math.round(after * 100) / 100}s between jobs`);
        }
    };

    /**
     * Copy the state of the pacer onto the metrics about to be reported. The pacer is per run and
     * the metrics per location, so these read as what this location saw of a limit that is really
     * the whole account's.
     * @param {IMetrics} metrics
     * @private
     */
    private _recordPace = (metrics: IMetrics): void => {
        metrics.throttled = this.scraper.pacer.throttledCount;
        metrics.pace = Math.round(this.scraper.pacer.delay * 100) / 100;
    };

    /**
     * Emit the begin event carrying LinkedIn's approximate total result count. Fired once per
     * location, before the pagination loop delivers any job. A count that cannot be read is
     * reported as -1 rather than aborting the run.
     * @param {Page} page
     * @param {string} tag
     * @private
     */
    private _emitBegin = async (page: Page, tag: string): Promise<void> => {
        const jobTotal = await AuthenticatedStrategy._readJobTotal(page);
        logger.debug(tag, `Total results reported by LinkedIn: ${jobTotal}`);
        this.scraper.emit(events.scraper.begin, { jobTotal });
    };

    /**
     * Open a url and wait for its page, asking again while LinkedIn answers with a throttle
     *
     * A 429 is the one failure that time alone fixes, so it is the one failure worth sitting
     * through: each refused attempt waits the next step of the ladder out and reports to the
     * pacer. The refusal is read both from the navigation response and from the throttle marker
     * left on the rendered page, so a throttle that arrives without a response object is still
     * caught. Every other outcome is handed straight back to the caller.
     *
     * @param {Page} page
     * @param {string} tag
     * @param {string} url
     * @param {(page: Page) => Promise<boolean>} wait returns whether the page arrived
     * @returns {Promise<IOpenResult>}
     * @private
     */
    private _openAndWait = async (
        page: Page,
        tag: string,
        url: string,
        wait: (page: Page) => Promise<boolean>,
    ): Promise<IOpenResult> => {
        for (const delay of [0, ...THROTTLE_BACKOFF_DELAYS]) {
            if (delay) {
                const waited = jitteredBackoff(delay);
                logger.warn(tag, `LinkedIn is throttling this run (HTTP ${THROTTLED_STATUS}), waiting ${Math.round(waited * 10) / 10}s before asking again`);
                await sleep(waited * 1000);
            }

            logger.info(tag, `Opening ${url}`);

            let response;

            try {
                response = await page.goto(url, { waitUntil: 'load' });
            }
            catch (err) {
                logger.warn(tag, 'Failed to open the page', err);
                return { success: false, throttled: false };
            }

            await sleep(this.scraper.pacer.delay * 1000);

            if (await wait(page)) {
                // A page that arrived is deliberately not reported as clean work: the unit the
                // pacer eases on is a job, and there are far more jobs than navigations.
                return { success: true, throttled: false };
            }

            // A refusal is read from the navigation response and from the throttle marker the
            // rendered page carries, so neither a null response nor a body Chrome has replaced
            // with its own error page hides it.
            const throttledByResponse = !!(response && response.status() === THROTTLED_STATUS);
            const throttledByPage = await isThrottled(page);

            if (!(throttledByResponse || throttledByPage)) {
                return { success: false, throttled: false };
            }

            // One report per refused attempt, so the pacer and the backoff count the same events
            this._slowDown(tag);
        }

        logger.warn(tag, `LinkedIn kept throttling this run after ${THROTTLE_BACKOFF_DELAYS.length} waits. Raise pacing.baseDelay, or reduce concurrency, to ask for less`);

        return { success: false, throttled: true };
    };

    /**
     * Open the next page of results and wait for its list to be rendered
     * @param {Page} page
     * @param {string} url the page to open, carrying its own `start` offset
     * @param {string} tag
     * @returns {Promise<IOpenResult>}
     * @private
     */
    private _paginate = async (
        page: Page,
        url: string,
        tag: string,
    ): Promise<IOpenResult> => {
        return this._openAndWait(page, tag, url, (p) => AuthenticatedStrategy._waitForJobItems(p, tag));
    };

    /**
     * Scrape a single job by its id, bypassing search and pagination
     *
     * A standalone /jobs/view/<id> page is obfuscated, so the job is opened inside a search
     * context: the currentJobId param renders the full detail panel for the requested job from
     * the url alone, with no card to click. Every field is read from the panel, document-scoped.
     *
     * @param {Browser} browser
     * @param {Page} page
     * @param {CDPSession} cdpSession
     * @param {string} jobId
     * @param {boolean} applyLink
     * @returns {Promise<void>}
     */
    public scrapeJob = async (
        browser: Browser,
        page: Page,
        cdpSession: CDPSession,
        jobId: string,
        applyLink: boolean,
    ): Promise<void> => {
        const tag = `[job:${jobId}]`;

        // Navigate to home page first, so the session can be established for the domain on screen
        logger.debug(tag, "Opening", urls.home);

        await page.goto(urls.home, {
            waitUntil: 'load',
        });

        // Mask the headless User-Agent before any authenticated request carries it.
        await maskUserAgent(page);

        // Establish the session for the configured mode, minting a fresh cookie where possible.
        const liAt = await authenticate(page.browser(), page, this._authConfig, tag);

        if (!liAt) {
            logger.error(tag, "Could not establish a session. Check the documentation on how to authenticate.");
            this.scraper.emit(events.scraper.invalidSession);
            throw new InvalidCookieException("Could not establish a session for the scraper.");
        }

        // The first session established is the baseline for detecting a rotation by end of run.
        if (this._initialLiAt === undefined) {
            this._initialLiAt = liAt;
        }

        // The currentJobId render depends on a search context, so the url carries a throwaway
        // keywords value alongside the requested job id
        const searchUrl = new URL(urls.jobsSearch);
        searchUrl.searchParams.set("keywords", SCRAPE_JOB_SEARCH_KEYWORDS);
        searchUrl.searchParams.set("currentJobId", jobId);

        // The panel is opened via the search route, but the link emitted to consumers stays the
        // canonical job url
        const jobLink = `${urls.jobs}/view/${jobId}`;

        logger.info(tag, "Opening", searchUrl.href);

        await page.goto(searchUrl.href, {
            waitUntil: 'load',
        });

        // Wait for the requested job's detail panel to render and settle
        const panelLoaded = await AuthenticatedStrategy._waitForJobPanel(page, jobId);

        if (!panelLoaded) {
            // A throttle empties the jar and leaves no panel: it must not be read as the job being
            // gone. Time alone clears a 429, so it is surfaced as an error rather than a notFound.
            if (await isThrottled(page)) {
                logger.warn(tag, "LinkedIn throttled the request, cannot confirm job");
                this.scraper.emit(events.scraper.error, `${tag}\tLinkedIn throttled the request (HTTP ${THROTTLED_STATUS}), cannot confirm job ${jobId}`);
                return;
            }

            // A lost session tells us nothing about the job itself, surface it as invalidSession
            if (await isSessionInvalid(page)) {
                logger.warn(tag, "Session is invalid, cannot confirm job");
                this.scraper.emit(events.scraper.invalidSession);
                return;
            }

            // Session healthy and the panel never rendered: the job genuinely does not exist or
            // is no longer available
            logger.warn(tag, `Job ${jobId} not found or no longer available`);
            this.scraper.emit(events.scraper.notFound, { jobId });
            return;
        }

        // Read the card-equivalent fields from the panel top card
        logger.debug(tag, 'Evaluating selectors', [
            selectors.panelTitle,
            selectors.panelCompany,
            selectors.tertiaryDescription,
        ]);

        const { title, company, place } = await page.evaluate(
            (titleSelector: string, companySelector: string, tertiarySelector: string) => {
                const titleEl = document.querySelector(titleSelector) as HTMLElement | null;
                const companyEl = document.querySelector(companySelector) as HTMLElement | null;
                const tertiaryEl = document.querySelector(tertiarySelector) as HTMLElement | null;

                const title = titleEl
                    ? (titleEl.innerText.split('\n').map(e => e.trim()).find(e => e.length) || "")
                    : "";

                const company = companyEl ? companyEl.innerText.trim() : "";

                // The container reads "<place> · <date> · <applicants>", but any segment can be
                // missing; the place is the first segment
                let place = "";

                if (tertiaryEl) {
                    const segments = tertiaryEl.innerText
                        .split('·')
                        .map(e => e.replace(/[\n\r\t ]+/g, ' ').trim())
                        .filter(e => e.length);

                    place = segments.length ? segments[0] : "";
                }

                return { title, company, place };
            },
            selectors.panelTitle,
            selectors.panelCompany,
            selectors.tertiaryDescription,
        );

        // The single-job panel exposes no machine date, so date is left empty and the extractor
        // approximates the ISO date from the relative date text
        const jobData = await AuthenticatedStrategy._extractJobData(page, cdpSession, {
            query: "",
            location: "",
            jobId: jobId,
            jobIndex: -1,
            link: jobLink,
            title: title,
            company: company,
            place: place,
            date: "",
            companyImgLink: "",
            applyLink: applyLink,
            tag: tag,
        });

        logger.info(tag, "Processed");
        this.scraper.emit(events.scraper.data, jobData);
    };

    /**
     * Run strategy
     * @param browser
     * @param page
     * @param cdpSession
     * @param url
     * @param query
     * @param location
     */
    public run = async (
        browser: Browser,
        page: Page,
        cdpSession: CDPSession,
        url: string,
        query: IQuery,
        location: string,
    ): Promise<IRunStrategyResult> => {
        let tag = `[${query.query}][${location}]`;

        const metrics: IMetrics = {
            processed: 0,
            failed: 0,
            missed: 0,
            skipped: 0,
            throttled: this.scraper.pacer.throttledCount,
            pace: this.scraper.pacer.delay,
        };

        let paginationIndex = query.options?.pageOffset || 0;

        // Number of times the session has been rebuilt for this location.
        let recoveries = 0;

        // Navigate to home page
        logger.debug(tag, "Opening", urls.home);

        await page.goto(urls.home, {
            waitUntil: 'load',
        });

        await sleep(this.scraper.pacer.delay * 1000);

        // Mask the headless User-Agent before any authenticated request carries it.
        await maskUserAgent(page);

        // Establish the session for the configured mode, minting a fresh cookie where possible.
        const liAt = await authenticate(page.browser(), page, this._authConfig, tag);

        if (!liAt) {
            logger.error(tag, "Could not establish a session. Check the documentation on how to authenticate.");
            this.scraper.emit(events.scraper.invalidSession);
            throw new InvalidCookieException("Could not establish a session for the scraper.");
        }

        // The first session established is the baseline for detecting a rotation by end of run.
        if (this._initialLiAt === undefined) {
            this._initialLiAt = liAt;
        }

        // Override start by the page offset
        const _url = new URL(url);
        _url.searchParams.set('start', `${paginationIndex * PAGINATION_SIZE}`);
        url = _url.href;

        // Open search url, sitting through any throttle
        let currentUrl = url;
        const openResult = await this._openAndWait(page, tag, currentUrl, AuthenticatedStrategy._waitForContainer);

        if (!openResult.success) {
            // A missing container on a valid session is genuinely no jobs; on an invalid one the
            // pagination loop below rebuilds the session and re-opens the page.
            if (!(await isSessionInvalid(page))) {
                logger.info(tag, `No jobs found, skip`);
                return { exit: false };
            }
        }

        // A limit of 0 means "scrape everything LinkedIn will serve": the loops run without a
        // processed count cap, stopping instead when a page yields no new job id or the pagination
        // ceiling is reached.
        const limit = query.options!.limit!;
        const isUnlimited = limit === 0;

        // Jobs already delivered are remembered for the whole location, covering LinkedIn
        // re-rendering a card it has already shown.
        const processedIds = new Set<string>();

        // begin carries the total result count and must fire exactly once per location.
        let beginEmitted = false;

        // Pagination loop
        while (isUnlimited || metrics.processed < limit) {
            // Verify session in the loop, rebuilding it through the recovery ladder when it is gone
            if (await isSessionInvalid(page)) {
                // A bare li_at cannot be renewed, so recovery is futile: fail fast.
                if (this._authConfig.mode === "liAt") {
                    logger.error(tag, "The supplied li_at session cookie was refused and cannot be renewed.");
                    this.scraper.emit(events.scraper.invalidSession);
                    throw new InvalidCookieException(
                        "The supplied li_at session cookie was refused and cannot be renewed. " +
                        "Supply a remember-me pair or an interactive-login profile to recover automatically."
                    );
                }

                if (recoveries >= MAX_SESSION_RECOVERIES) {
                    logger.warn(tag, `Session refused again after ${recoveries} recoveries`);
                    this.scraper.emit(events.scraper.invalidSession);
                    throw new InvalidCookieException(
                        "LinkedIn refused every session available and would not issue another. " +
                        "Check the documentation on how to obtain a valid session."
                    );
                }

                recoveries += 1;
                logger.warn(tag, "Session is no longer valid, rebuilding it and re-opening this page");

                if (!(await this._reopenResults(page.browser(), page, currentUrl, tag))) {
                    return { exit: false };
                }

                continue;
            }
            else {
                logger.info(tag, "Session is valid");
            }

            await AuthenticatedStrategy._hideChatPanel(page, tag);
            await AuthenticatedStrategy._acceptCookies(page, tag);
            await AuthenticatedStrategy._acceptPrivacy(page, tag);

            // Jobs are addressed by id, never by their position among the rendered cards: LinkedIn
            // renders only a handful of cards at a time and drops the others from the DOM, so
            // positions shift while the loop runs. The first read waits for the preliminary render
            // to be replaced.
            const jobIds = await AuthenticatedStrategy._waitForStableJobIds(page);

            if (!beginEmitted) {
                beginEmitted = true;
                await this._emitBegin(page, tag);
            }

            // LinkedIn serves the last page repeatedly once results run out, so in an unlimited run
            // a page carrying no id that has not already been processed marks the end of results.
            if (isUnlimited && jobIds.length && jobIds.every(jobId => processedIds.has(jobId))) {
                logger.info(tag, 'No new jobs on this page, results exhausted');
                break;
            }

            const knownIds = new Set<string>(jobIds);
            let nextIndex = 0;

            // Jobs loop
            while (isUnlimited || metrics.processed < limit) {
                // The id list grows as the page is scrolled, so it is re-read on every iteration
                for (const knownId of await AuthenticatedStrategy._getJobIds(page)) {
                    if (!knownIds.has(knownId)) {
                        knownIds.add(knownId);
                        jobIds.push(knownId);
                    }
                }

                if (nextIndex >= jobIds.length) {
                    if (!(await AuthenticatedStrategy._loadMoreJobs(page, jobIds.length))) {
                        break;
                    }
                    continue;
                }

                const jobIndex = nextIndex;
                const jobId = jobIds[jobIndex];
                nextIndex += 1;

                if (processedIds.has(jobId)) {
                    logger.debug(tag, `Job ${jobId} was already processed, skip`);
                    continue;
                }

                await sleep(this.scraper.pacer.delay * 1000);
                tag = `[${query.query}][${location}][${paginationIndex * PAGINATION_SIZE + jobIndex + 1}]`;

                let jobData: IData | undefined;

                try {
                    // Wait for the card of this job to be rendered before reading it
                    const loadCardResult = await AuthenticatedStrategy._loadJobCard(page, jobId);

                    if (!loadCardResult.success) {
                        // An id that left the list belongs to a render LinkedIn has since thrown
                        // away, so there is no job here to have failed
                        if (loadCardResult.missing) {
                            logger.debug(tag, loadCardResult.error);
                            continue;
                        }

                        logger.error(tag, loadCardResult.error);
                        metrics.failed += 1;
                        continue;
                    }

                    // Extract job main fields
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.jobItems,
                        selectors.link,
                        selectors.title,
                        selectors.company,
                        selectors.place,
                        selectors.date,
                    ]);

                    const jobFieldsResult = await page.evaluate(
                        (
                            jobItemSelector: string,
                            linkSelector: string,
                            titleSelector: string,
                            companySelector: string,
                            placeSelector: string,
                            dateSelector: string,
                        ) => {
                            const job = document.querySelector(jobItemSelector);

                            if (!job) {
                                return null;
                            }

                            const link = job.querySelector(linkSelector) as HTMLElement;

                            // Click job link and scroll
                            link.scrollIntoView();
                            link.click();

                            // Extract job link (relative)
                            const protocol = window.location.protocol + "//";
                            const hostname = window.location.hostname;
                            const jobLink = protocol + hostname + link.getAttribute("href");

                            let title = job.querySelector(titleSelector) ?
                                (<HTMLElement>job.querySelector(titleSelector)).innerText : "";

                            if (title.includes('\n')) {
                                title = title.split('\n')[1];
                            }

                            let company = "";

                            if (job.querySelector(companySelector)) {
                                let companyElem = job.querySelector<HTMLElement>(companySelector)!;
                                company = companyElem.innerText;
                            }

                            const companyImgLink = (<HTMLElement>job.querySelector("img"))?.getAttribute("src") ?? undefined;

                            const place = job.querySelector(placeSelector) ?
                                (<HTMLElement>job.querySelector(placeSelector)).innerText : "";

                            const date = job.querySelector(dateSelector) ?
                                (<HTMLElement>job.querySelector(dateSelector)).getAttribute('datetime') : "";

                            const isPromoted = !!(Array.from(job.querySelectorAll('li'))
                                .find(e => e.innerText === 'Promoted'));

                            return {
                                jobLink,
                                title,
                                company,
                                companyImgLink,
                                place,
                                date,
                                isPromoted,
                            };
                        },
                        getJobItemSelector(jobId),
                        selectors.link,
                        selectors.title,
                        selectors.company,
                        selectors.place,
                        selectors.date,
                    );

                    if (!jobFieldsResult) {
                        logger.error(tag, `Job ${jobId} card could not be read`);
                        metrics.failed += 1;
                        continue;
                    }

                    const jobLink = jobFieldsResult.jobLink;
                    const jobTitle = jobFieldsResult.title;
                    const jobCompany = jobFieldsResult.company;
                    const jobCompanyImgLink = jobFieldsResult.companyImgLink;
                    const jobPlace = jobFieldsResult.place;
                    const jobDate = jobFieldsResult.date ?? "";
                    const jobIsPromoted = jobFieldsResult.isPromoted;

                    // Promoted job
                    if (query.options?.skipPromotedJobs && jobIsPromoted) {
                        logger.info(tag, 'Skipped because promoted');
                        metrics.skipped += 1;
                        continue;
                    }

                    await sleep(this.scraper.pacer.delay * 1000);

                    // Try to load job details and extract job link
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.jobItems,
                    ]);

                    const loadDetailsResult = await AuthenticatedStrategy._loadJobDetails(page, jobId);

                    // Check if loading job details has failed
                    if (!loadDetailsResult.success) {
                        logger.error(tag, loadDetailsResult.error);
                        metrics.failed += 1;
                        continue;
                    }

                    // Extract the remaining detail-panel fields and assemble the payload
                    jobData = await AuthenticatedStrategy._extractJobData(page, cdpSession, {
                        query: query.query || "",
                        location: location,
                        jobId: jobId,
                        jobIndex: jobIndex,
                        link: jobLink,
                        title: jobTitle,
                        company: jobCompany,
                        place: jobPlace,
                        date: jobDate,
                        companyImgLink: jobCompanyImgLink,
                        applyLink: Boolean(query.options?.applyLink),
                        descriptionFn: query.options?.descriptionFn,
                        tag: tag,
                    });
                }
                catch(err: any) {
                    const errorMessage = `${tag}\t${err.message}`;
                    this.scraper.emit(events.scraper.error, errorMessage);
                    metrics.failed++;
                    continue;
                }
                finally {
                    // Every job counts as one unit of clean work the moment it is done with,
                    // however it ended: a job whose details a throttle refused has already reported
                    // that refusal through the response listener.
                    this._speedUp(tag);
                }

                // Emit data (NB: should be outside of try/catch block to be properly tested)
                if (jobData) {
                    this.scraper.emit(events.scraper.data, jobData);
                }

                metrics.processed += 1;
                processedIds.add(jobId);
                logger.info(tag, `Processed`);
            }

            tag = `[${query.query}][${location}]`;

            if (!jobIds.length) {
                logger.info(tag, `No jobs found, skip`);
                break;
            }

            logger.info(tag, 'No more jobs to process in this page');

            // Check if we reached the limit of jobs to process
            if (!isUnlimited && metrics.processed === limit) {
                logger.info(tag, 'Query limit reached!')

                // Emit metrics
                this._recordPace(metrics);
                this.scraper.emit(events.scraper.metrics, metrics);
                logger.info(tag, 'Metrics:', metrics);

                break;
            }
            else {
                metrics.missed += jobIds.length - nextIndex;

                // Emit metrics
                this._recordPace(metrics);
                this.scraper.emit(events.scraper.metrics, metrics);
                logger.info(tag, 'Metrics:', metrics);
            }

            // Try to paginate
            paginationIndex += 1;

            // LinkedIn stops serving results past MAX_RESULTS_CEILING, so an unlimited run does
            // not advance start beyond it.
            if (isUnlimited && paginationIndex * PAGINATION_SIZE >= MAX_RESULTS_CEILING) {
                logger.info(tag, `Reached the pagination ceiling of ${MAX_RESULTS_CEILING} results, LinkedIn serves no more past it, stop`);
                break;
            }

            logger.info(tag, `Pagination requested [${paginationIndex}]`);

            const nextUrl = new URL(url);
            nextUrl.searchParams.set('start', `${paginationIndex * PAGINATION_SIZE}`);
            currentUrl = nextUrl.href;

            let paginationResult = await this._paginate(page, currentUrl, tag);

            // The next page does not always render on the first attempt, and giving up there costs
            // every result past the first page. A throttled one is the exception: the backoff has
            // already waited it out for as long as it is going to.
            if (!paginationResult.success && !paginationResult.throttled) {
                logger.warn(tag, 'Pagination failed, retrying');
                await sleep(PAGINATION_RETRY_DELAY * 1000);
                paginationResult = await this._paginate(page, currentUrl, tag);
            }

            if (!paginationResult.success) {
                logger.info(tag, `Couldn\'t find more jobs for the running query`);
                break;
            }
        }

        return { exit: false };
    }
}
