const { inherits, }  = require("util");
const { EventEmitter, } = require("events");
const puppeteer = require("puppeteer");
const events = require("./events");
const states = require("./states");
const { wait, } = require("../utils/utils");
const logger = require("../logger/logger");

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
 * @private
 * @param page
 * @param jobTitle
 * @param jobCompany
 * @param timeout
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const _loadJobDetails = async (
    page,
    jobTitle,
    jobCompany,
    timeout = 2000
) => {
    const waitTime = 10;
    let elapsed = 0;
    let loaded = false;

    while(!loaded) {
        loaded = await page.evaluate(
            (jobTitle, jobCompany) => {
                const jobHeaderRight = document.querySelector(".topcard__content-left");
                return jobHeaderRight &&
                    jobHeaderRight.innerText.includes(jobTitle) &&
                    jobHeaderRight.innerText.includes(jobCompany);
            },
            jobTitle,
            jobCompany
        );

        if (loaded) return { success: true };

        await wait(waitTime);
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
 * @private
 * @param page
 * @param seeMoreJobsSelector
 * @param linksSelector
 * @param jobLinksTot
 * @param timeout
 * @returns {Promise<{success: boolean, error?: string}>}
 */
const _loadMoreJobs = async (
    page,
    seeMoreJobsSelector,
    linksSelector,
    jobLinksTot,
    timeout = 2000
) => {
    const waitTime = 10;
    let elapsed = 0;
    let loaded = false;
    let clicked = false;

    while(!loaded) {
        if (!clicked) {
            clicked = await page.evaluate(
                (seeMoreJobsSelector) => {
                    const button = document.querySelector(seeMoreJobsSelector);

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
            (linksSelector, jobLinksTot) => {
                window.scrollTo(0, document.body.scrollHeight);
                return document.querySelectorAll(linksSelector).length > jobLinksTot;
            },
            linksSelector,
            jobLinksTot
        );

        if (loaded) return { success: true };

        await wait(waitTime);
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
 * @param options {Object} Puppeteer browser options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 * @constructor
 */
function LinkedinScraper(options) {
    const _self = this;
    const _options = options;
    let _browser = undefined;
    let _state = states.notInitialized;

    /**
     * Initialize browser and listeners
     * @returns {Promise<void>}
     * @private
     */
    const _initialize = async () => {
        _state = states.initializing;

        _browser && _browser.removeAllListeners();

        const browserDefaults = {
            headless: true,
            args: [
                "--lang=en-GB",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
            ],
            defaultViewport: null,
            pipe: true,
            slowMo: 10,
        };

        const options = Object.assign(
            {},
            browserDefaults,
            _options,
        );

        _browser = await puppeteer.launch(options);

        _browser.on(events.puppeteer.browser.disconnected, () => {
            _self.emit(events.puppeteer.browser.disconnected);
        });

        _browser.on(events.puppeteer.browser.targetcreated, () => {
            _self.emit(events.puppeteer.browser.targetcreated);
        });

        _browser.on(events.puppeteer.browser.targetchanged, () => {
            _self.emit(events.puppeteer.browser.targetchanged);
        });

        _browser.on(events.puppeteer.browser.targetdestroyed, () => {
            _self.emit(events.puppeteer.browser.targetdestroyed);
        });

        _state = states.initialized;
    };

    /**
     * Do not use directly. Use run instead.
     * @param queries Array[String] of queries
     * @param locations Array[String] of locations
     * @param [paginationMax] {Number}
     * @param [descriptionProcessor] {Function} Custom function to extract job description on browser side
     * @param [optimize] {Boolean} Block resources such as images, stylesheets etc to improve bandwidth usage
     * @returns {Promise<void>}
     * @private
     */
    const _run = async (
        queries,
        locations,
        paginationMax,
        descriptionProcessor,
        optimize
    ) => {
        let tag;

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

        if (!Array.isArray(queries) && typeof(queries) === "string") {
            queries = [queries];
        }

        if (!Array.isArray(locations) && typeof(locations) === "string") {
            locations = [locations];
        }

        if (!_browser) {
            await _initialize();
        }

        const page = await _browser.newPage();

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
            .map(q => locations.map(l => [q, l]))
            .reduce((a, b) => a.concat(b));

        let jobsProcessed = 0;

        for (const tuple of queriesXlocations) {
            const [query, location] = tuple;
            tag = `[${query}][${location}]`;

            logger.info(tag, `Query="${query}"`, `Location="${location}"`);

            // Open url
            await page.goto(url, {
                waitLoad: true,
                waitNetworkIdle: true
            });

            logger.info(tag, "Page loaded");

            // Wait form search input selectors
            await page.waitForSelector("form#JOBS", {timeout: 10000});
            await page.waitForSelector(`button[form="JOBS"]`, {timeout: 10000});

            // Clear and fill search inputs
            await page.evaluate(() => document.querySelector(`form#JOBS input[name="keywords"]`).value = "");
            await page.evaluate(() => document.querySelector(`form#JOBS input[name="location"]`).value = "");
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
                    linksSelector => document.querySelectorAll(linksSelector).length,
                    linksSelector
                );

                logger.info(tag, "Job postings fetched: " + jobLinksTot);

                // Jobs loop
                for (jobIndex; jobIndex < jobLinksTot; ++jobIndex) {
                    let jobId, jobLink, jobTitle, jobCompany, jobPlace, jobDescription, jobDate;
                    let jobSenorityLevel, jobFunction, jobEmploymentType, jobIndustries;
                    let loadJobDetailsResponse;

                    try {
                        // Extract job main fields
                        [jobTitle, jobCompany, jobPlace, jobDate] = await page.evaluate(
                            (
                                linksSelector,
                                companiesSelector,
                                placesSelector,
                                datesSelector,
                                jobIndex
                            ) => {
                                return [
                                    document.querySelectorAll(linksSelector)[jobIndex].innerText,
                                    document.querySelectorAll(companiesSelector)[jobIndex].innerText,
                                    document.querySelectorAll(placesSelector)[jobIndex].innerText,
                                    document.querySelectorAll(datesSelector)[jobIndex]
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
                            page.evaluate((linksSelector, jobIndex) => {
                                    const linkElem = document.querySelectorAll(linksSelector)[jobIndex];
                                    linkElem.click();
                                    return [
                                        linkElem.parentNode.getAttribute("data-id"),
                                        linkElem.getAttribute("href"),
                                    ];
                                },
                                linksSelector,
                                jobIndex
                            ),

                            _loadJobDetails(page, jobTitle, jobCompany),
                        ]);

                        // Check if job details loading has failed
                        if (!loadJobDetailsResponse.success) {
                            const errorMessage = `${tag}\t${loadJobDetailsResponse.error}`;
                            logger.error(errorMessage);
                            _self.emit(events.custom.error, errorMessage);

                            continue;
                        }

                        // Use custom description processor if available
                        if (descriptionProcessor) {
                            jobDescription = await page.evaluate(`(${descriptionProcessor.toString()})();`)
                        }
                        else {
                            jobDescription = await page.evaluate(
                                (
                                    descriptionSelector,
                                ) => {
                                    return document.querySelector(descriptionSelector).innerText;
                                },
                                descriptionSelector
                            );
                        }

                        // Extract job criteria fields
                        [jobSenorityLevel, jobFunction, jobEmploymentType, jobIndustries] = await page.evaluate(
                            (
                                jobCriteriaSelector
                            ) => {
                                const items = document.querySelectorAll(jobCriteriaSelector);

                                const criterias = [
                                    'Seniority level',
                                    'Job function',
                                    'Employment type',
                                    'Industries'
                                ];

                                const nodeList = criterias.map(criteria => {
                                    const el = Array.from(items)
                                        .find(li => li.querySelector('h3').innerText === criteria);

                                    return el ? el.querySelectorAll('span') : [];
                                });

                                return Array.from(nodeList)
                                    .map(spanList => Array.from(spanList).map(e => e.innerText).join(', '));

                            },
                            jobCriteriaSelector
                        );
                    }
                    catch(err) {
                        const errorMessage = `${tag}\t${err.message}`;
                        _self.emit(events.custom.error, errorMessage);
                        continue;
                    }

                    // Emit data
                    _self.emit(events.custom.data, {
                        query: query,
                        location: location,
                        link: jobLink,
                        title: jobTitle,
                        company: jobCompany,
                        place: jobPlace,
                        description: jobDescription,
                        date: jobDate,
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
                    _self.emit(events.custom.error, errorMessage);

                    break;
                }

                await wait(500);
            }
        }

        // Close page
        await page.close();

        // Emit end event
        _self.emit(events.custom.end);
    };

    /**
     * Scrape linkedin jobs
     * @param queries Array[String] of queries
     * @param locations Array[String] of locations
     * @param [paginationMax] {Number} Max number of pagination
     * @param [descriptionProcessor] {Function} Custom function to extract job description on browser side
     * @param [optimize] {Boolean} Block resources such as images, stylesheets etc to improve bandwidth usage
     * @returns {Promise<void>}
     */
    this.run = async (
        queries,
        locations,
        {
            paginationMax,
            descriptionProcessor,
            optimize,
        } = {
            paginationMax: 10,
            descriptionProcessor: null,
            optimize: false,
        },
    ) => {
        try {
            if (_state === states.notInitialized) {
                await _initialize();
            }
            else if (_state === states.initializing) {
                const timeout = 10000;
                const waitTime = 10;
                let elapsed = 0;

                while(_state !== states.initialized) {
                    await wait(waitTime);
                    elapsed += waitTime;

                    if (elapsed >= timeout) {
                        throw new Error(`Initialize timeout exceeded: ${timeout}ms`);
                    }
                }
            }

            await _run(
                queries,
                locations,
                paginationMax,
                descriptionProcessor,
                optimize
            );
        }
        catch (err) {
            logger.error(err);
            _self.emit(events.custom.error, err);
        }
    };

    /**
     * Close browser instance
     * @returns {Promise<void>}
     */
    this.close = async () => {
        _browser && _browser.removeAllListeners() && await _browser.close();
        _browser = undefined;
        _state = states.notInitialized;
    };
}

/**
 * Enable logger
 * @returns void
 * @static
 */
LinkedinScraper.enableLogger = () => logger.enable();

/**
 * Disable logger
 * @returns void
 * @static
 */
LinkedinScraper.disableLogger = () => logger.disable();

/**
 * Enable logger info namespace
 * @returns void
 * @static
 */
LinkedinScraper.enableLoggerInfo = () => logger.enableInfo();

/**
 * Enable logger error namespace
 * @returns void
 * @static
 */
LinkedinScraper.enableLoggerError = () => logger.enableError();

// Extends EventEmitter
inherits(LinkedinScraper, EventEmitter);

module.exports = LinkedinScraper;
