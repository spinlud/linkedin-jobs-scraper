import { config } from "../../config";
import { RunStrategy, IRunStrategyResult, ILoadResult } from "./RunStrategy";
import { Browser, Page, CDPSession } from "puppeteer";
import { events, IData, IMetrics } from "../events";
import { sleep } from "../../utils/utils";
import { normalizeString, cleanApplicantCount } from "../../utils/string";
import { parseRelativeDate } from "../../utils/dates";
import { IQuery } from "../query";
import { logger } from "../../logger/logger";
import { urls } from "../constants";
import debug from "debug";

export const selectors = {
    container: '.scaffold-layout__list',
    chatPanel: '.msg-overlay-list-bubble',
    jobs: 'div.job-card-container',
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
    description: '.jobs-description',
    detailsPanel: '.jobs-search__job-details--container',
    detailsTop: '.jobs-details-top-card',
    details: '.jobs-details__main-content',
    insights: '.job-details-jobs-unified-top-card__container--two-pane li',
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

// A standalone /jobs/view/<id> page is obfuscated, so a single job is opened inside a search
// context: the currentJobId url param renders the full detail panel on its own, while a throwaway
// keywords value satisfies the search route
const SCRAPE_JOB_SEARCH_KEYWORDS = "engineer";

// Time budget for the single-job detail panel to render and settle
const SINGLE_JOB_PANEL_TIMEOUT = 15000;

// The description length must stay unchanged for this long before the panel is considered settled
const SINGLE_JOB_PANEL_QUIET_PERIOD = 1000;

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
    /**
     * Check if session is authenticated
     * @param {Page} page
     * @returns {Promise<boolean>}
     * @returns {Promise<ILoadResult>}
     * @static
     * @private
     */
    private static _isAuthenticatedSession = async (page: Page): Promise<boolean> => {
        const cookies = await page.browser().cookies();
        return cookies.some(e => e.name === "li_at");
    };

    /**
     * Load jobs
     * @param page {Page}
     * @param jobsTot {number}
     * @param timeout {number}
     * @static
     * @private
     */
    private static _loadJobs = async (
        page: Page,
        jobsTot: number,
        timeout: number = 2000,
    ): Promise<any> => {
        const pollingTime = 50;
        let elapsed = 0;

        await sleep(pollingTime);

        try {
            while (elapsed < timeout) {
                const jobsCount = await page.evaluate((selector) => {
                    return document.querySelectorAll(selector).length;
                }, selectors.jobs);

                if (jobsCount > jobsTot) {
                    return { success: true, count: jobsCount };
                }

                await sleep(pollingTime);
                elapsed += pollingTime;
            }
        }
        catch (err) {}

        return {
            success: false,
            error: `Timeout on loading jobs`
        };
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
     * Try to paginate
     * @param {Page} page
     * @param {string} tag
     * @param {string} paginationSize
     * @param {number} timeout
     * @returns {Promise<ILoadResult>}
     * @static
     * @private
     */
    private static _paginate = async (
        page: Page,
        tag: string,
        paginationSize: number = 25,
        timeout: number = 2000,
    ): Promise<ILoadResult> => {
        const url = new URL(page.url());

        // Extract offset from url
        let offset = parseInt(url.searchParams.get('start') || "0", 10);
        offset += paginationSize;

        // Update offset in url
        url.searchParams.set('start', '' + offset);

        logger.info(tag, 'Next offset: ', offset);
        logger.info(tag, 'Opening', url.toString());

        // Navigate new url
        await page.goto(url.toString(), {
            waitUntil: 'load',
        });

        const pollingTime = 100;
        let elapsed = 0;
        let loaded = false;

        logger.info(tag, 'Waiting for new jobs to load');

        // Wait for new jobs to load
        while (!loaded) {
            loaded = await page.evaluate(
                (selector) => {
                    return document.querySelectorAll(selector).length > 0;
                },
                selectors.jobs,
            );

            if (loaded) return { success: true };

            await sleep(pollingTime);
            elapsed += pollingTime;

            if (elapsed >= timeout) {
                return {
                    success: false,
                    error: `Timeout on pagination`
                };
            }
        }

        return { success: true };
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
     * Extract the detail-panel fields for a single job and assemble the emitted payload. The panel
     * must already be loaded. Card-derived and contextual fields are supplied by the caller; every
     * other field is read here, document-scoped, so the search loop and the single-job path share
     * a single extractor.
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

        // Navigate to home page first to set the session cookie
        logger.debug(tag, "Opening", urls.home);

        await page.goto(urls.home, {
            waitUntil: 'load',
        });

        // Set cookie
        logger.info("Setting authentication cookie");
        await page.browser().setCookie({
            name: "li_at",
            value: config.LI_AT_COOKIE!,
            domain: ".www.linkedin.com"
        });

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

        // Verify session
        if (!(await AuthenticatedStrategy._isAuthenticatedSession(page))) {
            logger.error("The provided session cookie is invalid. Check the documentation on how to obtain a valid session cookie.");
            this.scraper.emit(events.scraper.invalidSession);
            return;
        }

        // Wait for the requested job's detail panel to render and settle
        const panelLoaded = await AuthenticatedStrategy._waitForJobPanel(page, jobId);

        if (!panelLoaded) {
            // A lost session tells us nothing about the job itself, surface it as invalidSession
            if (!(await AuthenticatedStrategy._isAuthenticatedSession(page))) {
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
        };

        let paginationIndex = query.options?.pageOffset || 0;
        let paginationSize = 25;

        // Navigate to home page
        logger.debug(tag, "Opening", urls.home);

        await page.goto(urls.home, {
            waitUntil: 'load',
        });

        // Set cookie
        logger.info("Setting authentication cookie");
        await page.browser().setCookie({
            name: "li_at",
            value: config.LI_AT_COOKIE!,
            domain: ".www.linkedin.com"
        });

        // Override start by the page offset
        const _url = new URL(url);
        _url.searchParams.set('start', `${paginationIndex * paginationSize}`);
        url = _url.href;

        // Open search url
        logger.info(tag, "Opening", url);

        await page.goto(url, {
            waitUntil: 'load',
        });

        // Verify session
        if (!(await AuthenticatedStrategy._isAuthenticatedSession(page))) {
            logger.error("The provided session cookie is invalid. Check the documentation on how to obtain a valid session cookie.");
            this.scraper.emit(events.scraper.invalidSession);
            return { exit: true };
        }

        try {
            await page.waitForSelector(selectors.container, { timeout: 5000 });
        }
        catch(err: any) {
            logger.info(tag, `No jobs found, skip`);
            return { exit: false };
        }

        // Pagination loop
        while (metrics.processed < query.options!.limit!) {
            // Verify session in the loop
            if (!(await AuthenticatedStrategy._isAuthenticatedSession(page))) {
                logger.warn(tag, "Session is invalid, this may cause the scraper to fail.");
                this.scraper.emit(events.scraper.invalidSession);
            }
            else {
                logger.info(tag, "Session is valid");
            }

            await AuthenticatedStrategy._hideChatPanel(page, tag);
            await AuthenticatedStrategy._acceptCookies(page, tag);
            await AuthenticatedStrategy._acceptPrivacy(page, tag);

            let jobIndex = 0;

            // Get number of all job links in the page
            let jobsTot = await page.evaluate(
                (selector) => document.querySelectorAll(selector).length,
                selectors.jobs
            );

            if (jobsTot === 0) {
                logger.info(tag, `No jobs found, skip`);
                break;
            }

            // Jobs loop
            while (jobIndex < jobsTot && metrics.processed < query.options!.limit!) {
                tag = `[${query.query}][${location}][${paginationIndex * paginationSize + jobIndex + 1}]`;

                let jobId;
                let jobLink;
                let jobTitle;
                let jobCompany;
                let jobCompanyImgLink;
                let jobPlace;
                let jobDate: string = "";
                let loadDetailsResult;
                let jobIsPromoted = false;
                let jobData: IData | undefined;

                try {
                    // Extract job main fields
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.jobs,
                        selectors.link,
                        selectors.title,
                        selectors.company,
                        selectors.place,
                        selectors.date,
                    ]);

                    const jobFieldsResult = await page.evaluate(
                        (
                            jobsSelector: string,
                            linkSelector: string,
                            titleSelector: string,
                            companySelector: string,
                            placeSelector: string,
                            dateSelector: string,
                            jobIndex: number
                        ) => {
                            const job = document.querySelectorAll(jobsSelector)[jobIndex];
                            const link = job.querySelector(linkSelector) as HTMLElement;

                            // Click job link and scroll
                            link.scrollIntoView();
                            link.click();

                            // Extract job link (relative)
                            const protocol = window.location.protocol + "//";
                            const hostname = window.location.hostname;
                            const jobLink = protocol + hostname + link.getAttribute("href");

                            const jobId = job.getAttribute("data-job-id");

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
                                jobId,
                                jobLink,
                                title,
                                company,
                                companyImgLink,
                                place,
                                date,
                                isPromoted,
                            };
                        },
                        selectors.jobs,
                        selectors.link,
                        selectors.title,
                        selectors.company,
                        selectors.place,
                        selectors.date,
                        jobIndex
                    );

                    jobId = jobFieldsResult.jobId;
                    jobLink = jobFieldsResult.jobLink;
                    jobTitle = jobFieldsResult.title;
                    jobCompany = jobFieldsResult.company;
                    jobCompanyImgLink = jobFieldsResult.companyImgLink;
                    jobPlace = jobFieldsResult.place;
                    jobDate = jobFieldsResult.date ?? "";
                    jobIsPromoted = jobFieldsResult.isPromoted;

                    // Promoted job
                    if (query.options?.skipPromotedJobs && jobIsPromoted) {
                        logger.info(tag, 'Skipped because promoted');
                        metrics.skipped += 1;
                        jobIndex += 1;

                        if (metrics.processed < query.options!.limit! && jobIndex === jobsTot && jobsTot < paginationSize) {
                            const loadJobsResult = await AuthenticatedStrategy._loadJobs(page, jobsTot);

                            if (loadJobsResult.success) {
                                jobsTot = loadJobsResult.count;
                            }
                        }

                        if (jobIndex === jobsTot) {
                            break;
                        }
                        else {
                            continue;
                        }
                    }

                    // Try to load job details and extract job link
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.jobs,
                    ]);

                    loadDetailsResult = await AuthenticatedStrategy._loadJobDetails(page, jobId!);

                    // Check if loading job details has failed
                    if (!loadDetailsResult.success) {
                        logger.error(tag, loadDetailsResult.error);
                        jobIndex += 1;
                        continue;
                    }

                    // Extract the remaining detail-panel fields and assemble the payload
                    jobData = await AuthenticatedStrategy._extractJobData(page, cdpSession, {
                        query: query.query || "",
                        location: location,
                        jobId: jobId!,
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
                    jobIndex++;
                    metrics.failed++;
                    continue;
                }

                // Emit data (NB: should be outside of try/catch block to be properly tested)
                if (jobData) {
                    this.scraper.emit(events.scraper.data, jobData);
                }

                jobIndex += 1;
                metrics.processed += 1;
                logger.info(tag, `Processed`);

                // Try fetching more jobs
                if (metrics.processed < query.options!.limit! && jobIndex === jobsTot && jobsTot < paginationSize) {
                    const loadJobsResult = await AuthenticatedStrategy._loadJobs(page, jobsTot);

                    if (loadJobsResult.success) {
                        jobsTot = loadJobsResult.count;
                    }
                }

                if (jobIndex === jobsTot) {
                    break;
                }
            }

            tag = `[${query.query}][${location}]`;

            logger.info(tag, 'No more jobs to process in this page');

            // Check if we reached the limit of jobs to process
            if (metrics.processed === query.options!.limit!) {
                logger.info(tag, 'Query limit reached!')

                // Emit metrics
                this.scraper.emit(events.scraper.metrics, metrics);
                logger.info(tag, 'Metrics:', metrics);

                break;
            }
            else {
                metrics.missed += paginationSize - jobIndex;
            }

            // Emit metrics
            this.scraper.emit(events.scraper.metrics, metrics);
            logger.info(tag, 'Metrics:', metrics);

            // Try to paginate
            paginationIndex += 1;
            logger.info(tag, `Pagination requested [${paginationIndex}]`);
            const paginationResult = await AuthenticatedStrategy._paginate(page, tag);

            if (!paginationResult.success) {
                logger.info(tag, `Couldn\'t find more jobs for the running query`);
                break;
            }
        }

        return { exit: false };
    }
}
