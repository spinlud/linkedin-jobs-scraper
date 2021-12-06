import { config } from "../../config";
import { RunStrategy, IRunStrategyResult, ILoadResult } from "./RunStrategy";
import { Page } from "puppeteer";
import { events } from "../events";
import { sleep } from "../../utils/utils";
import { IQuery } from "../query";
import { logger } from "../../logger/logger";
import { urls } from "../constants";

export const selectors = {
    container: '.jobs-search-two-pane__container',
    chatPanel: '.msg-overlay-list-bubble',
    jobs: 'div.job-card-container',
    links: 'a.job-card-container__link',
    title: '.artdeco-entity-lockup__title',
    companies: '.artdeco-entity-lockup__subtitle',
    places: '.artdeco-entity-lockup__caption',
    dates: 'time',
    description: '.jobs-description',
    detailsPanel: '.jobs-search__job-details--container',
    detailsTop: '.jobs-details-top-card',
    details: '.jobs-details__main-content',
    criteria: '.jobs-box__group h3',
    pagination: '.jobs-search-two-pane__pagination',
    paginationNextBtn: 'li[data-test-pagination-page-btn].selected + li',
    paginationBtn: (index: number) => `li[data-test-pagination-page-btn="${index}"] button`,
};

/**
 * @class LoggedInRunStrategy
 * @extends RunStrategy
 */
export class LoggedInRunStrategy extends RunStrategy {

    /**
     * Check if session is authenticated
     * @param {Page} page
     * @returns {Promise<boolean>}
     * @returns {Promise<ILoadResult>}
     * @static
     * @private
     */
    private static _isAuthenticatedSession = async (page: Page): Promise<boolean> => {
        const cookies = await page.cookies();
        return cookies.some(e => e.name === "li_at");
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
        const pollingTime = 100;
        let elapsed = 0;
        let loaded = false;

        await sleep(pollingTime); // Baseline to wait

        while(!loaded) {
            loaded = await page.evaluate(
                (jobId, panelSelector, descriptionSelector) => {
                    const detailsPanel = document.querySelector(panelSelector);
                    const description = document.querySelector(descriptionSelector);
                    return detailsPanel && detailsPanel.innerHTML.includes(jobId) &&
                        description && description.innerText.length > 0;
                },
                jobId,
                selectors.detailsPanel,
                selectors.description,
            );

            if (loaded) return { success: true };

            await sleep(pollingTime);
            elapsed += pollingTime;

            if (elapsed >= timeout) {
                return {
                    success: false,
                    error: `Timeout on loading job details`
                };
            }
        }

        return { success: true };
    }

    /**
     * Try to paginate
     * @param {Page} page
     * @param {number} timeout
     * @param {string} tag
     * @returns {Promise<ILoadResult>}
     * @static
     * @private
     */
    private static _paginate = async (
        page: Page,
        tag: string,
        timeout: number = 2000,
    ): Promise<ILoadResult> => {
        // Check if there is a new page to load
        try {
            await page.waitForSelector(selectors.paginationNextBtn, {timeout: timeout});
        }
        catch(err: any) {
            return {
                success: false,
                error: `There are no more pages to visit`
            };
        }

        const url = new URL(page.url());

        // Extract offset from url
        let offset = parseInt(url.searchParams.get('start') || "0", 10);
        offset += 25;

        // Update offset in url
        url.searchParams.set('start', '' + offset);

        logger.debug(tag, "Opening", url.toString());

        // Navigate new url
        await page.goto(url.toString(), {
            waitUntil: 'load',
        });

        const pollingTime = 100;
        let elapsed = 0;
        let loaded = false;

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
                    const div = document.querySelector(selector);
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
     * Run strategy
     * @param page
     * @param url
     * @param query
     * @param location
     */
    public run = async (
        page: Page,
        url: string,
        query: IQuery,
        location: string,
    ): Promise<IRunStrategyResult> => {
        let tag = `[${query.query}][${location}]`;
        let processed = 0;
        let paginationIndex = 1;

        // Navigate to home page
        logger.debug(tag, "Opening", urls.home);

        await page.goto(urls.home, {
            waitUntil: 'load',
        });

        // Set cookie
        logger.info("Setting authentication cookie");
        await page.setCookie({
            name: "li_at",
            value: config.LI_AT_COOKIE!,
            domain: ".www.linkedin.com"
        });

        logger.info(tag, "Opening", url);

        await page.goto(url, {
            waitUntil: 'load',
        });

        // Verify session
        if (!(await LoggedInRunStrategy._isAuthenticatedSession(page))) {
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
        while (processed < query.options!.limit!) {
            // Verify session in the loop
            if (!(await LoggedInRunStrategy._isAuthenticatedSession(page))) {
                logger.warn(tag, "Session is invalid, this may cause the scraper to fail.");
                this.scraper.emit(events.scraper.invalidSession);
            }
            else {
                logger.info(tag, "Session is valid");
            }

            // Try to hide chat panel
            await LoggedInRunStrategy._hideChatPanel(page, tag);

            // Accept cookies
            await LoggedInRunStrategy._acceptCookies(page, tag);

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

            logger.info(tag, "Jobs fetched: " + jobsTot);

            // Jobs loop
            while (jobIndex < jobsTot && processed < query.options!.limit!) {
                tag = `[${query.query}][${location}][${processed + 1}]`;

                let jobId;
                let jobLink;
                let jobTitle;
                let jobCompany;
                let jobPlace;
                let jobDescription;
                let jobDescriptionHTML;
                let jobDate;
                let jobSenorityLevel;
                let jobFunction;
                let jobEmploymentType;
                let jobIndustry;
                let loadDetailsResult;

                try {
                    // Extract job main fields
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.jobs,
                        selectors.links,
                        selectors.companies,
                        selectors.places,
                        selectors.dates,
                    ]);

                    [jobId, jobLink, jobTitle, jobCompany, jobPlace, jobDate] = await page.evaluate(
                        (
                            jobsSelector: string,
                            linksSelector: string,
                            titleSelector: string,
                            companiesSelector: string,
                            placesSelector: string,
                            datesSelector: string,
                            jobIndex: number
                        ) => {
                            const job = document.querySelectorAll(jobsSelector)[jobIndex];
                            const link = job.querySelector(linksSelector) as HTMLElement;

                            // Click job link and scroll
                            link.scrollIntoView();
                            link.click();

                            // Extract job link (relative)
                            const protocol = window.location.protocol + "//";
                            const hostname = window.location.hostname;
                            const linkUrl = protocol + hostname + link.getAttribute("href");

                            const jobId = job.getAttribute("data-job-id");

                            const title = job.querySelector(titleSelector) ?
                                (<HTMLElement>job.querySelector(titleSelector)).innerText : "";

                            const company = job.querySelector(companiesSelector) ?
                                (<HTMLElement>job.querySelector(companiesSelector)).innerText : "";

                            const place = job.querySelector(placesSelector) ?
                                (<HTMLElement>job.querySelector(placesSelector)).innerText : "";

                            const date = job.querySelector(datesSelector) ?
                                (<HTMLElement>job.querySelector(datesSelector)).getAttribute('datetime') : "";

                            return [
                                jobId,
                                linkUrl,
                                title,
                                company,
                                place,
                                date,
                            ];
                        },
                        selectors.jobs,
                        selectors.links,
                        selectors.title,
                        selectors.companies,
                        selectors.places,
                        selectors.dates,
                        jobIndex
                    );

                    // Try to load job details and extract job link
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.jobs,
                    ]);

                    loadDetailsResult = await LoggedInRunStrategy._loadJobDetails(page, jobId!);

                    // Check if loading job details has failed
                    if (!loadDetailsResult.success) {
                        logger.error(tag, loadDetailsResult.error);
                        jobIndex += 1;
                        continue;
                    }

                    // Use custom description function if available
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.description,
                    ]);

                    if (query.options?.descriptionFn) {
                        [jobDescription, jobDescriptionHTML] = await Promise.all([
                            page.evaluate(`(${query.options.descriptionFn.toString()})();`),
                            page.evaluate((selector) => {
                                return (<HTMLElement>document.querySelector(selector)).outerHTML;
                            }, selectors.description)
                        ]);
                    }
                    else {
                        [jobDescription, jobDescriptionHTML] = await page.evaluate((selector) => {
                                const el = (<HTMLElement>document.querySelector(selector));
                                return [el.innerText, el.outerHTML];
                            },
                            selectors.description
                        );
                    }

                    jobDescription = jobDescription as string;

                    // Extract job criteria
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.criteria,
                    ]);

                    [
                        jobSenorityLevel,
                        jobEmploymentType,
                        jobIndustry,
                        jobFunction,
                    ] = await page.evaluate(
                        (
                            jobCriteriaSelector: string
                        ) => {
                            const nodes = document.querySelectorAll<HTMLElement>(jobCriteriaSelector);

                            const criteria = [
                                "Seniority Level",
                                "Employment Type",
                                "Industry",
                                "Job Functions",
                            ];

                            const [
                                senoriotyLevel,
                                employmentType,
                                industry,
                                jobFunctions,
                            ] = criteria.map(criteria => {
                                const el = Array.from(nodes)
                                    .find(node => node.innerText.trim() === criteria);

                                if (el && el.nextElementSibling) {
                                    const sibling = el.nextElementSibling as HTMLElement;
                                    return sibling.innerText
                                        .replace(/[\s]{2,}/g, ", ")
                                        .replace(/[\n\r]+/g, " ")
                                        .trim();
                                }
                                else {
                                    return "";
                                }
                            });

                            return [
                                senoriotyLevel,
                                employmentType,
                                industry,
                                jobFunctions
                            ];
                        },
                        selectors.criteria
                    );
                }
                catch(err: any) {
                    const errorMessage = `${tag}\t${err.message}`;
                    this.scraper.emit(events.scraper.error, errorMessage);
                    jobIndex++;
                    continue;
                }

                // Emit data
                this.scraper.emit(events.scraper.data, {
                    query: query.query || "",
                    location: location,
                    jobId: jobId!,
                    jobIndex: jobIndex,
                    link: jobLink!,
                    title: jobTitle!,
                    company: jobCompany!,
                    place: jobPlace!,
                    description: jobDescription! as string,
                    descriptionHTML: jobDescriptionHTML! as string,
                    date: jobDate!,
                    senorityLevel: jobSenorityLevel,
                    jobFunction: jobFunction,
                    employmentType: jobEmploymentType,
                    industries: jobIndustry,
                });

                jobIndex += 1;
                processed += 1;
                logger.info(tag, `Processed`);

                if (processed < query.options!.limit! && jobIndex === jobsTot) {
                    logger.info(tag, 'Fecthing more jobs');
                    const fetched = await page.evaluate(
                        (selector) => document.querySelectorAll(selector).length,
                        selectors.jobs
                    );

                    if (fetched === jobsTot) {
                        logger.info(tag, "No more jobs available in this page");
                    }
                    else {
                        jobsTot = fetched;
                    }
                }
            }

            // Check if we reached the limit of jobs to process
            if (processed === query.options!.limit!) break;

            // Try pagination to load more jobs
            paginationIndex += 1;
            logger.info(tag, `Pagination requested (${paginationIndex})`);
            // const paginationResult = await LoggedInRunStrategy._paginate(page, paginationIndex);
            const paginationResult = await LoggedInRunStrategy._paginate(page, tag);

            // Check if loading jobs has failed
            if (!paginationResult.success) {
                logger.info(tag, paginationResult.error);
                logger.info(tag, "There are no more jobs available for the current query");
                break;
            }
        }

        return { exit: false };
    }
}
