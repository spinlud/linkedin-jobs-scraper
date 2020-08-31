import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import puppeteer from "puppeteer-extra";
import { Browser, BrowserContext, Page, LaunchOptions } from "puppeteer";
import { events, IEventListeners } from "./events";
import { states } from "./states";
import { browserDefaults, queryOptionsDefault } from "./defaults";
import { logger } from "../logger/logger";
import { sleep } from "../utils/utils";
import { getQueryParams } from "../utils/url";
import { urls, selectors } from "./constants";
import { IQuery, IQueryOptions, IQueryValidationError } from "./query";
import { getRandomUserAgent } from "../utils/browser";

puppeteer.use(require("puppeteer-extra-plugin-stealth")());

/**
 * Main class
 * @extends EventEmitter
 * @param options {LaunchOptions} Puppeteer browser options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 * @constructor
 */
class LinkedinScraper extends (EventEmitter as new () => TypedEmitter<IEventListeners>) {
    private _browser: Browser | undefined = undefined;
    private _context: BrowserContext | undefined = undefined;
    private _state = states.notInitialized;

    public options: LaunchOptions;

    constructor(options: LaunchOptions) {
        super();
        this.options = options;
    }

    /**
     * Enable logger
     * @returns void
     * @static
     */
    public static enableLogger = () => logger.enable();

    /**
     * Disable logger
     * @returns void
     * @static
     */
    public static disableLogger = () => logger.disable();

    /**
     * Enable logger info namespace
     * @returns void
     * @static
     */
    public static enableLoggerInfo = () => logger.enableInfo();

    /**
     * Enable logger error namespace
     * @returns void
     * @static
     */
    public static enableLoggerError = () => logger.enableError();

    /**
     * Wait for job details to load
     * @param page {Page}
     * @param jobTitle {string}
     * @param jobCompany {string}
     * @param timeout {number}
     * @returns {Promise<{success: boolean, error?: string}>}
     * @static
     * @private
     */
    private static _loadJobDetails = async (
        page: Page,
        jobTitle: string,
        jobCompany: string,
        timeout: number = 2000
    ): Promise<{ success: boolean, error?: string }> => {
        const waitTime = 10;
        let elapsed = 0;
        let loaded = false;

        while(!loaded) {
            loaded = await page.evaluate(
                (jobTitle: string, jobCompany: string) => {
                    const jobHeaderRight = document.querySelector(".topcard__content-left") as HTMLElement;
                    return jobHeaderRight &&
                        jobHeaderRight.innerText.includes(jobTitle) &&
                        jobHeaderRight.innerText.includes(jobCompany);
                },
                jobTitle,
                jobCompany
            );

            if (loaded) return { success: true };

            await sleep(waitTime);
            elapsed += waitTime;

            if (elapsed >= timeout) {
                return {
                    success: false,
                    error: `Timeout on loading job: '${jobTitle}'`
                };
            }
        }

        return { success: true };
    };

    /**
     * Try to load more jobs
     * @param page {Page}
     * @param jobLinksTot {number}
     * @param timeout {number}
     * @returns {Promise<{success: boolean, error?: string}>}
     * @private
     */
    private static _loadMoreJobs = async (
        page: Page,
        jobLinksTot: number,
        timeout: number = 2000
    ): Promise<{ success: boolean, error?: string }> => {
        const waitTime = 10;
        let elapsed = 0;
        let loaded = false;
        let clicked = false;

        await page.evaluate(_ => {
            window.scrollTo(0, document.body.scrollHeight)
        });

        while(!loaded) {
            if (!clicked) {
                clicked = await page.evaluate(
                    (selector: string) => {
                        const button = <HTMLElement>document.querySelector(selector);

                        if (button) {
                            button.click();
                            return true;
                        }
                        else {
                            return false;
                        }
                    },
                    selectors.seeMoreJobs
                );
            }

            loaded = await page.evaluate(
                (selector: string, jobLinksTot: number) => {
                    window.scrollTo(0, document.body.scrollHeight);
                    return document.querySelectorAll(selector).length > jobLinksTot;
                },
                selectors.links,
                jobLinksTot
            );

            if (loaded) return { success: true };

            await sleep(waitTime);
            elapsed += waitTime;

            if (elapsed >= timeout) {
                return {
                    success: false,
                    error: `Timeout on loading more jobs`
                };
            }
        }

        return { success: true };
    };

    /**
     * Initialize browser
     * @private
     */
    private async _initialize() {
        this._state = states.initializing;

        this._browser && this._browser.removeAllListeners();

        this._browser = await puppeteer.launch({
            ...browserDefaults,
            ...this.options,
        });

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
     * Validate query
     * @param {IQuery} query
     * @returns {IQueryValidationError[]}
     * @private
     */
    private _validateQuery(query: IQuery): IQueryValidationError[] {
        const errors: IQueryValidationError[] = [];

        if (query.query && typeof(query.query) !== "string") {
            errors.push({
                param: "query",
                reason: `Must be a string`
            });
        }

        if (query.options) {
            const {
                locations,
                filters,
                descriptionFn,
                limit,
            } = query.options;

            if (locations && (!Array.isArray(locations) || !locations.every(e => typeof(e) === "string"))) {
                errors.push({
                    param: "options.locations",
                    reason: `Must be an array of strings`
                });
            }

            if (descriptionFn && typeof(descriptionFn) !== "function") {
                errors.push({
                    param: "options.descriptionFn",
                    reason: `Must be a function`
                });
            }

            if (query.options.hasOwnProperty("optimize") && typeof(query.options.optmize) !== "boolean") {
                errors.push({
                    param: "options.optimize",
                    reason: `Must be a boolean`
                });
            }

            if (limit && (!Number.isInteger(limit) || limit <= 0)) {
                errors.push({
                    param: "options.limit",
                    reason: `Must be a positive integer`
                });
            }

            if (filters) {
                if (filters.companyJobsUrl) {
                    if (typeof(filters.companyJobsUrl) !== "string") {
                        errors.push({
                            param: "options.filters.companyUrl",
                            reason: `Must be a string`
                        });
                    }

                    try {
                        const baseUrl = "https://www.linkedin.com/jobs/search/?";
                        new URL(filters.companyJobsUrl); // CHeck url validity
                        const queryParams = getQueryParams(filters.companyJobsUrl);

                        if (!filters.companyJobsUrl.toLowerCase().startsWith(baseUrl)
                            || !queryParams.hasOwnProperty("f_C") || !queryParams["f_C"]) {
                            errors.push({
                                param: "options.filters.companyJobsUrl",
                                reason: `Url is invalid. Please check the documentation on how find a company jobs link from LinkedIn`
                            });
                        }
                    }
                    catch(err) {
                        errors.push({
                            param: "options.filters.companyJobsUrl",
                            reason: `Must be a valid url`
                        });
                    }
                }
            }
        }

        return errors;
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
     */
    private _run = async (
        queries: IQuery | IQuery[],
        options?: IQueryOptions
    ): Promise<void> => {
        let tag;

        if (!Array.isArray(queries)) {
            queries = [queries];
        }

        // Validation
        for (const query of queries) {
            const errors = this._validateQuery(query);

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
            query.options = {
                ...queryOptionsDefault,
                ...options,
                ...query.options
            };

            // Locations loop
            for (const location of query.options!.locations!) {
                let jobsProcessed = 0;
                tag = `[${query.query}][${location}]`;
                logger.info(tag, `Starting new query:`, `query="${query.query}"`, `location="${location}"`);

                // Open new page in incognito context
                const page = await this._context!.newPage();

                // Set a random user agent
                await page.setUserAgent(getRandomUserAgent());

                // Enable optimization if required
                if (query.options!.optmize) {
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

                // Build search url
                const searchUrl = this._buildSearchUrl(query.query || "", location, query.options!);

                await page.goto(searchUrl, {
                    waitUntil: 'networkidle0',
                });

                // Scroll down page to the bottom
                await page.evaluate(_ => {
                    window.scrollTo(0, document.body.scrollHeight)
                });

                // Wait for lazy loading jobs
                try {
                    await page.waitForSelector(selectors.container, { timeout: 5000 });
                }
                catch(err) {
                    logger.info(tag, `No jobs found, skip`);
                    continue;
                }

                let jobIndex = 0;

                // Pagination loop
                while (jobIndex < query.options!.limit!) {
                    // Get number of all job links in the page
                    const jobLinksTot = await page.evaluate(
                        (linksSelector: string) => document.querySelectorAll(linksSelector).length,
                        selectors.links
                    );

                    if (jobLinksTot === 0) {
                        logger.info(tag, `No jobs found, skip`);
                        break;
                    }

                    logger.info(tag, "Jobs fetched: " + jobLinksTot);

                    // Jobs loop
                    for (jobIndex; jobIndex < jobLinksTot; ++jobIndex) {
                        tag = `[${query.query}][${location}][${jobIndex + 1}]`;

                        let jobId;
                        let jobLink;
                        let jobApplyLink;
                        let jobTitle;
                        let jobCompany;
                        let jobPlace;
                        let jobDescription;
                        let jobDescriptionHTML;
                        let jobDate;
                        let jobSenorityLevel;
                        let jobFunction;
                        let jobEmploymentType;
                        let jobIndustries;
                        let loadJobDetailsResponse;

                        try {
                            // Extract job main fields
                            [jobTitle, jobCompany, jobPlace, jobDate] = await page.evaluate(
                                (
                                    linksSelector: string,
                                    companiesSelector: string,
                                    placesSelector: string,
                                    datesSelector: string,
                                    jobIndex: number
                                ) => {
                                    return [
                                        (<HTMLElement>document.querySelectorAll(linksSelector)[jobIndex]).innerText,
                                        (<HTMLElement>document.querySelectorAll(companiesSelector)[jobIndex]).innerText,
                                        (<HTMLElement>document.querySelectorAll(placesSelector)[jobIndex]).innerText,
                                        (<HTMLElement>document.querySelectorAll(datesSelector)[jobIndex])
                                            .getAttribute('datetime')
                                    ];
                                },
                                selectors.links,
                                selectors.companies,
                                selectors.places,
                                selectors.dates,
                                jobIndex
                            );

                            // Load job and extract description: skip in case of error
                            [[jobId, jobLink], loadJobDetailsResponse] = await Promise.all([
                                page.evaluate((linksSelector: string, jobIndex: number) => {
                                        const linkElem = <HTMLElement>document.querySelectorAll(linksSelector)[jobIndex];
                                        linkElem.click();

                                        return [
                                            (<HTMLElement>linkElem!.parentNode!).getAttribute("data-id"),
                                            linkElem.getAttribute("href"),
                                        ];
                                    },
                                    selectors.links,
                                    jobIndex
                                ),

                                LinkedinScraper._loadJobDetails(page, jobTitle!, jobCompany!),
                            ]);

                            // Check if job details loading has failed
                            if (!loadJobDetailsResponse.success) {
                                const errorMessage = `${tag}\t${loadJobDetailsResponse.error}`;
                                logger.error(errorMessage);
                                this.emit(events.scraper.error, errorMessage);

                                continue;
                            }

                            // Use custom description function if available
                            if (query.options?.descriptionFn) {
                                [jobDescription, jobDescriptionHTML] = await Promise.all([
                                    page.evaluate(`(${query.options.descriptionFn.toString()})();`),
                                    // page.evaluate((selector) => {
                                    //     return new XMLSerializer()
                                    //         .serializeToString((<HTMLElement>document.querySelector(selector)));
                                    page.evaluate((selector) => {
                                        return (<HTMLElement>document.querySelector(selector)).outerHTML;
                                    }, selectors.description)
                                ]);
                            }
                            else {
                                [jobDescription, jobDescriptionHTML] = await page.evaluate((selector) => {
                                        const el = (<HTMLElement>document.querySelector(selector));
                                        // return [el.innerText, new XMLSerializer().serializeToString(el)];
                                        return [el.innerText, el.outerHTML];
                                    },
                                    selectors.description
                                );
                            }

                            // Extract apply link
                            jobApplyLink = await page.evaluate((selector) => {
                                const applyBtn = document.querySelector<HTMLElement>(selector);
                                return applyBtn ? applyBtn.getAttribute("href") : null;
                            }, selectors.applyLink);

                            // Extract other job fields
                            [
                                jobSenorityLevel,
                                jobFunction,
                                jobEmploymentType,
                                jobIndustries,
                            ] = await page.evaluate(
                                (
                                    jobCriteriaSelector: string
                                ) => {
                                    const items = document.querySelectorAll(jobCriteriaSelector);

                                    const criteria = [
                                        'Seniority level',
                                        'Job function',
                                        'Employment type',
                                        'Industries'
                                    ];

                                    const nodeList = criteria.map(criteria => {
                                        const el = Array.from(items)
                                            .find(li =>
                                                (<HTMLElement>li.querySelector('h3')).innerText === criteria);

                                        return el ? el.querySelectorAll('span') : [];
                                    });

                                    return Array.from(nodeList)
                                        .map(spanList => Array.from(spanList as Array<HTMLElement>)
                                            .map(e => e.innerText).join(', '));
                                },
                                selectors.jobCriteria
                            );
                        }
                        catch(err) {
                            const errorMessage = `${tag}\t${err.message}`;
                            this.emit(events.scraper.error, errorMessage);
                            continue;
                        }

                        // Emit data
                        this.emit(events.scraper.data, {
                            query: query.query || "",
                            location: location,
                            link: jobLink!,
                            ...jobApplyLink && { applyLink: jobApplyLink },
                            title: jobTitle!,
                            company: jobCompany!,
                            place: jobPlace!,
                            description: jobDescription! as string,
                            descriptionHTML: jobDescriptionHTML! as string,
                            date: jobDate!,
                            senorityLevel: jobSenorityLevel,
                            jobFunction: jobFunction,
                            employmentType: jobEmploymentType,
                            industries: jobIndustries,
                        });

                        jobsProcessed++;
                        logger.info(tag, `Processed`);

                        // Check if we reached the limit of jobs to process
                        if (jobIndex === query.options!.limit! - 1) break;
                    }

                    // Check if we reached the limit of jobs to process
                    if (jobIndex === query.options!.limit! - 1) break;

                    // Check if there are more jobs to load
                    logger.info(tag, "Checking for new jobs to load...");

                    const loadMoreJobsResponse = await LinkedinScraper._loadMoreJobs(
                        page,
                        jobLinksTot
                    );

                    // Check if loading jobs has failed
                    if (!loadMoreJobsResponse.success) {
                        logger.info(tag, "There are no more jobs available for the current query");
                        break;
                    }

                    await sleep(500);
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
     */
    public run = async (
        queries: IQuery | IQuery[],
        options?: IQueryOptions
    ) => {
        try {
            if (this._state === states.notInitialized) {
                await this._initialize();
            }
            else if (this._state === states.initializing) {
                const timeout = 10000;
                const waitTime = 10;
                let elapsed = 0;

                while(this._state !== states.initialized) {
                    await sleep(waitTime);
                    elapsed += waitTime;

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
    public close = async () => {
        this._browser && this._browser.removeAllListeners() && await this._browser.close();
        this._browser = undefined;
        this._state = states.notInitialized;
    };
}

export { LinkedinScraper };
