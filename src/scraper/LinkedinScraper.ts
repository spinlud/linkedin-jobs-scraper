import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import puppeteer, { Browser, Page, LaunchOptions } from "puppeteer";
import { events, IEventListeners } from "./events";
import { states } from "./states";
import { IRunOptions } from "./options";
import { runOptionsDefaults, browserDefaults } from "./defaults";
import { logger } from "../logger/logger";
import { sleep } from "../utils/utils";
import {
    ERelevanceFilterOptions,
    ETimeFilterOptions,
    relevanceFilter,
    timeFilter,
    FilterFnOptions,
    filterFn,
} from "./filters";
import TypedEventEmitter from "typed-emitter";

const TypedEventEmitter = new EventEmitter() as TypedEmitter<IEventListeners>;

const url = "https://www.linkedin.com/jobs";
const containerSelector = ".results__container.results__container--two-pane";
const linksSelector = ".jobs-search__results-list li a.result-card__full-card-link";
const datesSelector = 'time';
const companiesSelector = ".result-card__subtitle.job-result-card__subtitle";
const placesSelector = ".job-result-card__location";
const descriptionSelector = ".description__text";
const seeMoreJobsSelector = "button.infinite-scroller__show-more-button";
const jobCriteriaSelector = "li.job-criteria__item";

/**
 * Wait for job details to load
 * @param page {Page}
 * @param jobTitle {string}
 * @param jobCompany {string}
 * @param timeout {number}
 * @returns {Promise<{success: boolean, error?: string}>}
 * @private
 */
const _loadJobDetails = async (
    page: Page,
    jobTitle: string,
    jobCompany: string,
    timeout: number = 2000
) => {
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
 * @param seeMoreJobsSelector {string}
 * @param linksSelector {string}
 * @param jobLinksTot {number}
 * @param timeout {number}
 * @returns {Promise<{success: boolean, error?: string}>}
 * @private
 */
const _loadMoreJobs = async (
    page: Page,
    seeMoreJobsSelector: string,
    linksSelector: string,
    jobLinksTot: number,
    timeout: number = 2000
) => {
    const waitTime = 10;
    let elapsed = 0;
    let loaded = false;
    let clicked = false;

    while(!loaded) {
        if (!clicked) {
            clicked = await page.evaluate(
                (seeMoreJobsSelector: string) => {
                    const button = <HTMLElement>document.querySelector(seeMoreJobsSelector);

                    if (button) {
                        button.click();
                        return true;
                    }
                    else {
                        return false;
                    }
                },
                seeMoreJobsSelector
            );
        }

        loaded = await page.evaluate(
            (linksSelector: string, jobLinksTot: number) => {
                window.scrollTo(0, document.body.scrollHeight);
                return document.querySelectorAll(linksSelector).length > jobLinksTot;
            },
            linksSelector,
            jobLinksTot
        );

        if (loaded) return { success: true };

        await sleep(waitTime);
        elapsed += waitTime;

        if (elapsed >= timeout) {
            return {
                success: false,
                error: `Timeout on fetching more jobs`
            };
        }
    }

    return { success: true };
};

/**
 * Main class
 * @extends EventEmitter
 * @param options {LaunchOptions} Puppeteer browser options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 * @constructor
 */
class LinkedinScraper extends (EventEmitter as new () => TypedEventEmitter<IEventListeners>) {
    private _browser: Browser | undefined = undefined;
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
     * Scrape linkedin jobs
     * @param queries {string | Array<string>}
     * @param locations {string | Array<string>}
     * @param options {IRunOptions}
     * @returns {Promise<void>}
     * @private
     */
    private _run = async (
        queries: string | Array<string>,
        locations: string | Array<string>,
        options?: IRunOptions
    ) => {
        let tag;
        const paginationMax = options?.paginationMax || 1;
        const descriptionProcessor = options?.descriptionProcessor;
        const filter = options?.filter;
        const optimize = !!options?.optimize;

        if (!(typeof(queries) === "string" || Array.isArray(queries))) {
            throw new Error(`'queries' parameter must be string or Array`);
        }

        if (!(typeof(locations) === "string" || Array.isArray(locations))) {
            throw new Error(`'locations' parameter must be string or Array`);
        }

        if (!(Number.isInteger(paginationMax) && paginationMax > 0)) {
            throw new Error(`'paginationMax' must be a positive integer`);
        }

        if (descriptionProcessor && typeof(descriptionProcessor) !== "function") {
            throw new Error(`'descriptionProcessor' must be a function`)
        }

        if (!Array.isArray(queries)) {
            queries = [queries];
        }

        if (!Array.isArray(locations)) {
            locations = [locations];
        }

        if (filter) {
            if (filter.relevance && !(Object.keys(ERelevanceFilterOptions).some(e => e === filter.relevance))) {
                throw new Error(`filter.relevance must be one of (${Object.keys(ERelevanceFilterOptions).join(', ')})`);
            }

            if (filter.time && !(Object.keys(ETimeFilterOptions).some(e => e === filter.time))) {
                throw new Error(`filter.time must be one of (${Object.keys(ETimeFilterOptions).join(', ')})`);
            }
        }

        if (!this._browser) {
            await this._initialize();
        }

        const page = await this._browser!.newPage();

        // Resources we don't want to load to improve bandwidth usage
        if (optimize) {
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

        // Array([query, location])
        const queriesXlocations = queries
            .map(q => (locations as Array<string>).map(l => [q, l]))
            .reduce((a, b) => a.concat(b));

        for (const tuple of queriesXlocations) {
            let jobsProcessed = 0;
            const [query, location] = tuple;
            tag = `[${query}][${location}]`;

            logger.info(tag, `Query="${query}"`, `Location="${location}"`);

            // Open url
            await page.goto(url, {
                waitUntil: 'networkidle0',
            });

            logger.info(tag, "Page loaded");

            // Wait form search input selectors
            await Promise.all([
                page.waitForSelector("form#JOBS", {timeout: 10000}),
                page.waitForSelector(`button[form="JOBS"]`, {timeout: 10000})
            ]);

            // Clear search inputs
            await page.evaluate(() =>
                (<HTMLInputElement>document.querySelector(`form#JOBS input[name="keywords"]`)).value = "");
            await page.evaluate(() =>
                (<HTMLInputElement>document.querySelector(`form#JOBS input[name="location"]`)).value = "");

            // Fill search inputs
            await page.type(`form#JOBS input[name="keywords"]`, query);
            await page.type(`form#JOBS input[name="location"]`, location);

            // Wait submit button
            await page.focus(`button[form="JOBS"]`);

            // Submit search
            await Promise.all([
                page.keyboard.press("Enter"),
                page.waitForNavigation(),
            ]);

            logger.info(tag, "Search done");

            // Apply filters (if any)
            if (filter) {
                if (filter.relevance && filter.relevance !== ERelevanceFilterOptions.RELEVANT) {
                    let filterFnOptions: FilterFnOptions = {
                        dropdownBtnSelector: relevanceFilter.dropdownBtnSelector,
                        choiceIndex: relevanceFilter.choices[filter.relevance]
                    };

                    try {
                        await Promise.all([
                            page.evaluate(filterFn, filterFnOptions),
                            page.waitForNavigation()
                        ]);

                        console.log(tag, `Successfully applied relevance filter (${filter.relevance})`);
                    }
                    catch(err) {
                        console.error(tag, err);
                        process.exit(1);
                    }
                }

                if (filter.time && filter.time !== ETimeFilterOptions.ANY) {
                    let filterFnOptions: FilterFnOptions = {
                        dropdownBtnSelector: timeFilter.dropdownBtnSelector,
                        choiceIndex: timeFilter.choices[filter.time]
                    };

                    try {
                        await Promise.all([
                            page.evaluate(filterFn, filterFnOptions),
                            page.waitForNavigation()
                        ]);

                        console.log(tag, `Successfully applied time filter (${filter.time})`);
                    }
                    catch(err) {
                        console.error(tag, err);
                        process.exit(1);
                    }
                }
            }

            // Scroll down page to the bottom
            await page.evaluate(_ => {
                window.scrollTo(0, document.body.scrollHeight)
            });

            // Wait for lazy loading jobs
            await page.waitForSelector(containerSelector);

            let jobIndex = 0;

            // Scroll until there are no more job postings to visit or paginationMax is reached
            let paginationIndex = 0;

            // Pagination loop
            while (++paginationIndex <= paginationMax) {
                tag = `[${query}][${location}][${paginationIndex}]`;

                // Get number of all job links in the page
                const jobLinksTot = await page.evaluate(
                    (linksSelector: string) => document.querySelectorAll(linksSelector).length,
                    linksSelector
                );

                logger.info(tag, "Job postings fetched: " + jobLinksTot);

                // Jobs loop
                for (jobIndex; jobIndex < jobLinksTot; ++jobIndex) {
                    let jobId;
                    let jobLink;
                    let jobTitle;
                    let jobCompany;
                    let jobPlace;
                    let jobDescription;
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
                            linksSelector,
                            companiesSelector,
                            placesSelector,
                            datesSelector,
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
                                linksSelector,
                                jobIndex
                            ),

                            _loadJobDetails(page, jobTitle!, jobCompany!),
                        ]);

                        // Check if job details loading has failed
                        if (!loadJobDetailsResponse.success) {
                            const errorMessage = `${tag}\t${loadJobDetailsResponse.error}`;
                            logger.error(errorMessage);
                            this.emit(events.scraper.error, errorMessage);

                            continue;
                        }

                        // Use custom description processor if available
                        if (descriptionProcessor) {
                            jobDescription =
                                await page.evaluate(`(${descriptionProcessor.toString()})();`) as string;
                        }
                        else {
                            jobDescription = await page.evaluate(
                                (
                                    descriptionSelector: string,
                                ) => {
                                    return (<HTMLElement>document.querySelector(descriptionSelector)).innerText;
                                },
                                descriptionSelector
                            );
                        }

                        // Extract job criteria fields
                        [jobSenorityLevel, jobFunction, jobEmploymentType, jobIndustries] = await page.evaluate(
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
                            jobCriteriaSelector
                        );
                    }
                    catch(err) {
                        const errorMessage = `${tag}\t${err.message}`;
                        this.emit(events.scraper.error, errorMessage);
                        continue;
                    }

                    // Emit data
                    this.emit(events.scraper.data, {
                        query: query,
                        location: location,
                        link: jobLink!,
                        title: jobTitle!,
                        company: jobCompany!,
                        place: jobPlace!,
                        description: jobDescription!,
                        date: jobDate!,
                        senorityLevel: jobSenorityLevel,
                        jobFunction: jobFunction,
                        employmentType: jobEmploymentType,
                        industries: jobIndustries,
                    });

                    jobsProcessed++;
                    logger.info(tag, `Processed job ${jobsProcessed}`);
                }

                if (paginationIndex === paginationMax) break;

                // Check if there are more job postings to load
                logger.info(tag, "Checking for new job postings to fetch...");

                const loadMoreResponse = await _loadMoreJobs(
                    page,
                    seeMoreJobsSelector,
                    linksSelector,
                    jobLinksTot
                );

                // Check it loading job postings has failed
                if (!loadMoreResponse.success) {
                    const errorMessage = `${tag}\t${loadMoreResponse.error}`;
                    logger.error(errorMessage);
                    this.emit(events.scraper.error, errorMessage);

                    break;
                }

                await sleep(500);
            }
        }

        // Close page
        await page.close();

        // Emit end event
        this.emit(events.scraper.end);
    };

    /**
     * Scrape linkedin jobs
     * @param queries {string | Array<string>}
     * @param locations {string | Array<string>}
     * @param options {IRunOptions}
     * @returns {Promise<void>}
     */
    public run = async (
        queries: string | Array<string>,
        locations: string | Array<string>,
        options: IRunOptions = runOptionsDefaults
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
                locations,
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
