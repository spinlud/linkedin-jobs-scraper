import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import deepmerge from "deepmerge";
import puppeteer from "puppeteer-extra";
import { Browser, BrowserContext, Page, LaunchOptions } from "puppeteer";
import { events, IEventListeners } from "./events";
import { states } from "./states";
import { browserDefaults, queryOptionsDefault } from "./defaults";
import { sleep } from "../utils/utils";
import { getQueryParams } from "../utils/url";
import { urls, } from "./constants";
import { IQuery, IQueryOptions, validateQuery } from "./query";
import { getRandomUserAgent } from "../utils/browser";
import { Scraper } from "./Scraper";
import { RunStrategy, LoggedInRunStrategy, LoggedOutRunStrategy } from "./strategies";
import { logger } from "../logger/logger";

puppeteer.use(require("puppeteer-extra-plugin-stealth")());

/**
 * Main class
 * @extends EventEmitter
 * @param options {LaunchOptions} Puppeteer browser options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 * @constructor
 */
class LinkedinScraper extends Scraper {
    private _runStrategy: RunStrategy;
    private _browser: Browser | undefined = undefined;
    private _context: BrowserContext | undefined = undefined;
    private _state = states.notInitialized;

    /**
     * @constructor
     * @param {LaunchOptions} options
     */
    constructor(options: LaunchOptions) {
        super(options);

        if (process.env.LI_AT_COOKIE) {
            this._runStrategy = new LoggedInRunStrategy(this);
            logger.info("Env variable LI_AT_COOKIE detected. Implementing LoggedInRunStrategy.")
        }
        else {
            this._runStrategy = new LoggedOutRunStrategy(this);
            logger.info("Implementing LoggedOutRunStrategy.")
        }
    }

    /**
     * Initialize browser
     * @private
     */
    private async _initialize() {
        this._state = states.initializing;

        this._browser && this._browser.removeAllListeners();

        const launchOptions = deepmerge.all([browserDefaults, this.options]);
        logger.info('Setting chrome launch options', launchOptions);
        this._browser = await puppeteer.launch(launchOptions);

        this._context = await this._browser.createIncognitoBrowserContext();

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
     * Build jobs search url
     * @param {string} query
     * @param {string} location
     * @param {IQueryOptions} options
     * @returns {string}
     * @private
     */
    private _buildSearchUrl = (query: string, location: string, options: IQueryOptions): string => {
        const url = new URL(urls.jobsSearch);

        if (query && query.length) {
            url.searchParams.append("keywords", query);
        }

        if (location && location.length) {
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
                url.searchParams.append("f_TP", options.filters.time);
            }

            if (options.filters.type) {
                url.searchParams.append("f_JT", options.filters.type);
            }

            if (options.filters.experience) {
                url.searchParams.append("f_E", options.filters.experience);
            }
        }

        url.searchParams.append("redirect", "false");
        url.searchParams.append("position", "1");
        url.searchParams.append("pageNum", "0");

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

        if (!Array.isArray(queries)) {
            queries = [queries];
        }

        // Validation
        for (const query of queries) {
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

        // Queries loop
        for (const query of queries) {
            // Merge options
            const optionsToMerge = [queryOptionsDefault];
            options && optionsToMerge.push(options);
            query.options && optionsToMerge.push(query.options);
            query.options = deepmerge.all(optionsToMerge);

            // Add default location if none provided
            if (!query?.options?.locations?.length) {
                query.options.locations = ["Worldwide"];
            }

            // Locations loop
            for (const location of query.options!.locations!) {
                // let processed = 0;
                tag = `[${query.query}][${location}]`;
                logger.info(tag, `Starting new query:`, `query="${query.query}"`, `location="${location}"`);
                logger.info(tag, `Query options`, query.options);

                // Open new page in incognito context
                const page = await this._context!.newPage();

                // Method to create a faster Page
                // From: https://github.com/shirshak55/scrapper-tools/blob/master/src/fastPage/index.ts#L113
                const session = await page.target().createCDPSession()
                await page.setBypassCSP(true)
                await session.send('Page.enable');
                await session.send('Page.setWebLifecycleState', {
                    state: 'active',
                });

                // Set a random user agent
                await page.setUserAgent(getRandomUserAgent());

                // Enable optimization if required
                if (query.options!.optimize) {
                    await page.setRequestInterception(true);

                    const resourcesToBlock = [
                        "image",
                        "stylesheet",
                        "media",
                        "font",
                        "texttrack",
                        "object",
                        "beacon",
                        "csp_report",
                        "imageset",
                    ];

                    page.on("request", request => {
                        if (
                            resourcesToBlock.some(r => request.resourceType() === r)
                            || request.url().includes(".jpg")
                            || request.url().includes(".jpeg")
                            || request.url().includes(".png")
                            || request.url().includes(".gif")
                            || request.url().includes(".css")
                        ) {
                            request.abort();
                        }
                        else {
                            request.continue();
                        }
                    });
                }
                else {
                    await page.setRequestInterception(false);
                }

                // Rate limiting check
                page.on("response",  response => {
                    if (response.status() === 429) {
                        logger.warn(tag, "Error 429 too many requests. You would probably need to use a higher 'slowMo' value and/or reduce the number of concurrent queries.");
                    }
                });

                // Build search url
                const searchUrl = this._buildSearchUrl(query.query || "", location, query.options!);

                // Run strategy
                const runStrategyResult = await this._runStrategy.run(page, searchUrl, query, location);

                // Check if forced exit is required
                if (runStrategyResult.exit) {
                    logger.warn(tag, "Forced termination");
                    return;
                }

                // Close page
                page && await page.close();
            }
        }

        // Emit end event
        this.emit(events.scraper.end);
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
        catch (err) {
            logger.error(err);
            this.emit(events.scraper.error, err);
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
