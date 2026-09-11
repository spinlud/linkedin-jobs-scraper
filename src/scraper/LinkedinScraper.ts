import deepmerge from 'deepmerge';
import puppeteer from 'puppeteer';
import { Browser, BrowserContext, HTTPRequest, Page } from 'puppeteer';
import { events, IEventListeners } from './events';
import { states } from './states';
import { browserDefaults, queryOptionsDefault } from './defaults';
import { sleep } from '../utils/utils';
import { getQueryParams, getJobId } from '../utils/url';
import { urls, } from './constants';
import { IQuery, IQueryOptions, Location, validateQuery } from './query';
import { createPacer } from './Pacer';
import { THROTTLED_STATUS } from './constants';
import { Scraper, ScraperOptions } from './Scraper';
import { AuthenticatedStrategy } from './strategies';
import { resolveAuthConfig, SESSION_COOKIE_NAME } from './auth';
import { logger } from '../logger/logger';

// puppeteer.use(require('puppeteer-extra-plugin-stealth')()); // TODO: breaks with new target tabs: to investigate

/**
 * Main class
 * @extends EventEmitter
 * @param options {ScraperOptions} Puppeteer browser options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 * @constructor
 */
class LinkedinScraper extends Scraper {
    private _runStrategy: AuthenticatedStrategy;
    private _browser: Browser | undefined = undefined;
    // private _context: BrowserContext | undefined = undefined;
    private _state = states.notInitialized;

    /**
     * @constructor
     * @param {ScraperOptions} options
     */
    constructor(options: ScraperOptions) {
        super(options);

        // Authentication is mandatory: the config resolves to a mode or throws.
        const authConfig = resolveAuthConfig(options.auth);
        this._runStrategy = new AuthenticatedStrategy(this, authConfig);
        logger.info(`Using ${AuthenticatedStrategy.name} with auth mode '${authConfig.mode}'`);
    }

    /**
     * Initialize browser
     * @private
     */
    private async _initialize() {
        this._state = states.initializing;

        this._browser && this._browser.removeAllListeners();

        // `pacing` is a scraper concept, not a Puppeteer launch option, so it is kept out of
        // what is handed to puppeteer.launch.
        const { pacing, ...launchableOptions } = this.options;
        const launchOptions = deepmerge.all([browserDefaults, launchableOptions]);
        logger.info('Setting chrome launch options', launchOptions);
        this._browser = await puppeteer.launch(launchOptions);

        // Close initial browser page
        await (await this._browser.pages())[0].close();

        this._browser.on(events.puppeteer.browser.disconnected, () => {
            this.emit(events.puppeteer.browser.disconnected);
        });

        this._browser.on(events.puppeteer.browser.targetcreated, () => {
            this.emit(events.puppeteer.browser.targetcreated);
        });

        this._browser.on(events.puppeteer.browser.targetchanged, () => {
            this.emit(events.puppeteer.browser.targetchanged);
        });

        this._browser.on(events.puppeteer.browser.targetdestroyed, () => {
            this.emit(events.puppeteer.browser.targetdestroyed);
        });

        this._state = states.initialized;
    }

    /**
     * Return whether a url points at LinkedIn, so a 429 seen on it counts as the account being
     * throttled rather than a third party failing
     * @param {string} url
     * @returns {boolean}
     * @private
     * @static
     */
    private static _isSameOriginLinkedIn = (url: string): boolean => {
        try {
            return new URL(url).hostname.toLowerCase().endsWith("linkedin.com");
        }
        catch (err) {
            return false;
        }
    };

    /**
     * Build jobs search url
     * @param {string} query
     * @param {string | Location} location
     * @param {IQueryOptions} options
     * @returns {string}
     * @private
     */
    private _buildSearchUrl = (query: string, location: string | Location, options: IQueryOptions): string => {
        const url = new URL(urls.jobsSearch);

        if (query && query.length) {
            url.searchParams.append("keywords", query);
        }

        if (location instanceof Location) {
            url.searchParams.append("geoId", location.geoId);
        }
        else if (location && location.length) {
            url.searchParams.append("location", location);
        }

        if (options && options.filters) {
            if (options.filters.companyJobsUrl) {
                const queryParams = getQueryParams(options.filters.companyJobsUrl);
                url.searchParams.append("f_C", queryParams["f_C"]);
            }

            if (options.filters.relevance) {
                url.searchParams.append("sortBy", options.filters.relevance);
            }

            if (options.filters.time && options.filters.time.length) {
                url.searchParams.append("f_TPR", options.filters.time);
            }

            if (options.filters.baseSalary && options.filters.baseSalary.length) {
                url.searchParams.append("f_SB2", options.filters.baseSalary);
            }

            if (options.filters.type) {
                if (!Array.isArray(options.filters.type)) {
                    options.filters.type = [options.filters.type]
                }

                url.searchParams.append("f_JT", options.filters.type.join(","));
            }

            if (options.filters.experience) {
                if (!Array.isArray(options.filters.experience)) {
                    options.filters.experience = [options.filters.experience]
                }

                url.searchParams.append("f_E", options.filters.experience.join(","));
            }

            if (options.filters.onSiteOrRemote) {
                if (!Array.isArray(options.filters.onSiteOrRemote)) {
                    options.filters.onSiteOrRemote = [options.filters.onSiteOrRemote]
                }

                url.searchParams.append("f_WT", options.filters.onSiteOrRemote.join(","));
            }

            if (options.filters.industry) {
                if (!Array.isArray(options.filters.industry)) {
                    options.filters.industry = [options.filters.industry]
                }

                url.searchParams.append("f_I", options.filters.industry.join(","));
            }

            if (options.filters.jobFunction) {
                if (!Array.isArray(options.filters.jobFunction)) {
                    options.filters.jobFunction = [options.filters.jobFunction]
                }

                url.searchParams.append("f_F", options.filters.jobFunction.join(","));
            }

            if (options.filters.benefits) {
                if (!Array.isArray(options.filters.benefits)) {
                    options.filters.benefits = [options.filters.benefits]
                }

                url.searchParams.append("f_BE", options.filters.benefits.join(","));
            }

            if (options.filters.commitments) {
                if (!Array.isArray(options.filters.commitments)) {
                    options.filters.commitments = [options.filters.commitments]
                }

                url.searchParams.append("f_JC", options.filters.commitments.join(","));
            }

            if (options.filters.easyApply) {
                url.searchParams.append("f_AL", "true");
            }

            if (options.filters.under10Applicants) {
                url.searchParams.append("f_EA", "true");
            }
        }

        url.searchParams.append("start", "0");

        return url.href;
    }

    /**
     * Scrape linkedin jobs
     * @param {IQuery | IQuery[]} queries
     * @param {IQueryOptions} [options]
     * @return {Promise<void>}
     * @private
     */
    private _run = async (
        queries: IQuery | IQuery[],
        options?: IQueryOptions
    ): Promise<void> => {
        let tag: string;

        // One pacer per run, threaded across every sequential location so a delay learned while
        // throttled on one location persists into the next (same account). A fresh run starts
        // from the configured base delay again.
        this.pacer = createPacer(this.options.pacing);

        if (!Array.isArray(queries)) {
            queries = [queries];
        }

        // Merge options and validate
        for (const query of queries) {
            const optionsToMerge = [queryOptionsDefault];
            options && optionsToMerge.push(options);
            query.options && optionsToMerge.push(query.options);
            query.options = deepmerge.all(optionsToMerge, {
                arrayMerge: (destinationArray, sourceArray, options) => sourceArray,
            });

            // Add default location if none provided
            if (!query?.options?.locations?.length) {
                query.options.locations = ["Worldwide"];
            }

            const errors = validateQuery(query);

            if (errors.length) {
                logger.error(errors);
                process.exit(1);
            }
        }

        // Initialize browser
        if (!this._browser) {
            await this._initialize();
        }

        const wsEndpoint = this._browser!.wsEndpoint();

        if (wsEndpoint) {
            logger.info('Websocket debugger url:', wsEndpoint);
        }

        // Queries loop
        for (const query of queries) {
            if (query.options?.optimize) {
                logger.warn('Query option optimize=true: this could cause issues in jobs loading or pagination');
            }

            // Locations loop
            for (const location of query.options!.locations!) {
                const locationTag = location instanceof Location ? location.label : location;
                tag = `[${query.query}][${locationTag}]`;
                logger.info(tag, `Starting new query:`, `query="${query.query}"`, `location="${locationTag}"`);
                logger.info(tag, `Query options`, query.options);

                // Open a fresh page in the default browser context for this location
                const page = await this._browser!.newPage();

                try {
                    // Create Chrome Developer Tools session
                    const cdpSession = await page.createCDPSession();

                    // Disable Content Security Policy: needed for pagination to work properly in anonymous mode
                    await page.setBypassCSP(true);

                    // Tricks to speed up page
                    await cdpSession.send('Page.enable');
                    await cdpSession.send('Page.setWebLifecycleState', {
                        state: 'active',
                    });

                    // Enable request interception
                    await page.setRequestInterception(true);

                    const onRequest = async (request: HTTPRequest) => {
                        const url = new URL(request.url());
                        const domain = url.hostname.split(".").slice(-2).join(".").toLowerCase();

                        // Block tracking and other stuff not useful
                        const toBlock = [
                            'li/track',
                            'realtime.www.linkedin.com/realtime',
                            'platform.linkedin.com/litms',
                            'linkedin.com/sensorCollect',
                            'linkedin.com/pixel/tracking',
                        ];

                        if (toBlock.some(e => url.pathname.includes(e))) {
                            return request.abort();
                        }

                        // Block 3rd part domains requests
                        if (!["linkedin.com", "licdn.com"].includes(domain)) {
                            return request.abort();
                        }

                        // If optimization is enabled, block other resource types
                        if (query.options!.optimize) {
                            const resourcesToBlock = [
                                "image",
                                "stylesheet",
                                "media",
                                "font",
                                "imageset",
                            ];

                            if (
                                resourcesToBlock.some(r => request.resourceType() === r)
                                || request.url().includes(".jpg")
                                || request.url().includes(".jpeg")
                                || request.url().includes(".png")
                                || request.url().includes(".gif")
                                || request.url().includes(".css")
                            ) {
                                return request.abort();
                            }
                        }

                        await request.continue();
                    }

                    // Add listener
                    page.on("request", onRequest);

                    // Error response and rate limiting check
                    page.on("response",  response => {
                        if (response.status() === THROTTLED_STATUS) {
                            // Navigation 429s are handled by the open-and-wait backoff ladder, which
                            // reports them to the pacer itself; only same-origin resource/XHR refusals
                            // (job detail fetches) are reported here, so neither is counted twice.
                            const request = response.request();

                            if (!request.isNavigationRequest() && LinkedinScraper._isSameOriginLinkedIn(response.url())) {
                                this.pacer.throttled();
                            }

                            logger.warn(tag, "Error 429 too many requests. You would probably need to use a higher 'pacing.baseDelay' value and/or reduce the number of concurrent queries.");
                        }
                        else if (response.status() >= 400) {
                            logger.warn(tag, response.status(), `Error for request ${response.request().url()}`)
                        }
                    });

                    // Build search url
                    const searchUrl = this._buildSearchUrl(query.query || "", location, query.options!);

                    // Run strategy
                    const runStrategyResult = await this._runStrategy.run(
                        this._browser!,
                        page,
                        cdpSession,
                        searchUrl,
                        query,
                        locationTag,
                    );

                    // Check if forced exit is required
                    if (runStrategyResult.exit) {
                        logger.warn(tag, "Forced termination");
                        return;
                    }
                }
                finally {
                    // Close the per-location page on every exit path (forced exit, error, normal end)
                    if (page) {
                        try {
                            await page.close();
                        }
                        catch {
                            // Best effort
                        }
                    }
                }
            }
        }

        // Surface a rotated session cookie before ending
        await this._emitRefreshedSession();

        // Emit end event
        this.emit(events.scraper.end);
    };

    /**
     * Report the session cookie when it no longer matches the one in effect right after
     * authentication, so a caller can persist the rotated value for the next run. Applies to all
     * auth modes, since a minted or profile session can rotate just as a supplied one can.
     * @private
     */
    private _emitRefreshedSession = async (): Promise<void> => {
        if (!this._browser) {
            return;
        }

        const initialLiAt = this._runStrategy.initialLiAt;

        if (!initialLiAt) {
            return;
        }

        // Best-effort read: the CDP cookies call can intermittently fail, and a completed scrape
        // must not be reported as failed just because the session cookie could not be surfaced.
        let page: Page | undefined;

        try {
            // A live page gives Chrome a target to resolve the default context's cookies against
            page = await this._browser.newPage();
            const cookies = await this._browser.cookies();
            const liAtCookie = cookies.find(cookie => cookie.name === SESSION_COOKIE_NAME);

            if (liAtCookie && liAtCookie.value && liAtCookie.value !== initialLiAt) {
                this.emit(events.scraper.sessionRefreshed, { liAt: liAtCookie.value });
            }
        }
        catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn("Could not read session cookie at end of run; skipping sessionRefreshed:", message);
        }
        finally {
            if (page) {
                try {
                    await page.close();
                }
                catch {
                    // Best effort
                }
            }
        }
    };

    /**
     * Scrape linkedin jobs
     * @param {IQuery | IQuery[]} queries
     * @param {IQueryOptions} [options]
     * @return {Promise<void>}
     */
    public run = async (
        queries: IQuery | IQuery[],
        options?: IQueryOptions
    ): Promise<void> => {
        try {
            if (this._state === states.notInitialized) {
                await this._initialize();
            }
            else if (this._state === states.initializing) {
                const timeout = 10000;
                const pollingTime = 100;
                let elapsed = 0;

                while(this._state !== states.initialized) {
                    await sleep(pollingTime);
                    elapsed += pollingTime;

                    if (elapsed >= timeout) {
                        throw new Error(`Initialize timeout exceeded: ${timeout}ms`);
                    }
                }
            }

            await this._run(
                queries,
                options
            );
        }
        catch (err: any) {
            // logger.error(err);
            this.emit(events.scraper.error, err);
            await this.close();
            throw err;
        }
    };

    /**
     * Scrape a single job by its url or id, bypassing search and pagination
     * @param {string} urlOrId a numeric id, a '/jobs/view/<id>' url or a '?currentJobId=<id>' url
     * @param {{ applyLink?: boolean }} [options]
     * @return {Promise<void>}
     */
    public scrapeJob = async (
        urlOrId: string,
        options?: { applyLink?: boolean }
    ): Promise<void> => {
        // Resolve the job id synchronously so unparseable input throws before any browser launch
        const jobId = getJobId(urlOrId);

        // A single job can only be opened with an authenticated session
        const strategy = this._runStrategy;

        if (!(strategy instanceof AuthenticatedStrategy)) {
            throw new Error("scrapeJob requires an authenticated session. Set the LI_AT_COOKIE environment variable.");
        }

        try {
            if (this._state === states.notInitialized) {
                await this._initialize();
            }
            else if (this._state === states.initializing) {
                const timeout = 10000;
                const pollingTime = 100;
                let elapsed = 0;

                while(this._state !== states.initialized) {
                    await sleep(pollingTime);
                    elapsed += pollingTime;

                    if (elapsed >= timeout) {
                        throw new Error(`Initialize timeout exceeded: ${timeout}ms`);
                    }
                }
            }

            // Open a new page and prepare a Chrome Developer Tools session for the single job
            const page = await this._browser!.newPage();
            const cdpSession = await page.createCDPSession();

            // Disable Content Security Policy
            await page.setBypassCSP(true);

            // Tricks to speed up page
            await cdpSession.send('Page.enable');
            await cdpSession.send('Page.setWebLifecycleState', {
                state: 'active',
            });

            // Run single-job strategy
            await strategy.scrapeJob(
                this._browser!,
                page,
                cdpSession,
                jobId,
                Boolean(options?.applyLink),
            );

            // Surface a rotated session cookie before ending
            await this._emitRefreshedSession();

            // Close page
            page && await page.close();

            // Emit end event
            this.emit(events.scraper.end);
        }
        catch (err: any) {
            this.emit(events.scraper.error, err);
            await this.close();
            throw err;
        }
    };

    /**
     * Close browser instance
     * @returns {Promise<void>}
     */
    public close = async (): Promise<void> => {
        try {
            if (this._browser) {
                this._browser.removeAllListeners() && await this._browser.close();
            }
        }
        finally {
            this._browser = undefined;
            this._state = states.notInitialized;
        }
    };
}

export { LinkedinScraper };
