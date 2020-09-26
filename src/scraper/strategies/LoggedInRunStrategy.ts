import { RunStrategy, ILoadResult } from "./RunStrategy";
import { Page } from "puppeteer";
import { events } from "../events";
import { sleep } from "../../utils/utils";
import { IQuery } from "../query";
import { logger } from "../../logger/logger";

export const selectors = {
    container: '.jobs-search-two-pane__container',
    toggleChatBtn: '.msg-overlay-bubble-header__controls button:nth-of-type(2)',
    links: 'a.job-card-container__link.job-card-list__title',
    companies: 'div[data-test-job-card-list__company-name]',
    places: 'li[data-test-job-card-list__location]',
    dates: 'time[data-test-job-card-container__listed-time=true]',
    description: '.jobs-description',
    detailsTop: '.jobs-details-top-card',
    details: '.jobs-details__main-content',
    criteria: '.jobs-box__group h3',
    pagination: '.jobs-search-two-pane__pagination',
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
     * @param {number} timeout
     * @static
     * @private
     */
    private static _loadJobDetails = async (
        page: Page,
        timeout: number = 2000,
    ): Promise<ILoadResult> => {
        const pollingTime = 100;
        let elapsed = 0;
        let loaded = false;

        await sleep(pollingTime); // Baseline to wait

        while(!loaded) {
            // We assume that job is loaded when description is present
            loaded = await page.evaluate(
                (detailsSelector, descriptionSelector) => {
                    const details = <HTMLElement>document.querySelector(detailsSelector);
                    const description = <HTMLElement>document.querySelector(descriptionSelector);
                    return details && description && description.innerText.length > 0;
                },
                selectors.details,
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
     * @param {number} paginationIndex
     * @param {number} timeout
     * @returns {Promise<ILoadResult>}
     * @static
     * @private
     */
    private static _paginate = async (
        page: Page,
        paginationIndex: number,
        timeout: number = 2000,
    ): Promise<ILoadResult> => {
        const pollingTime = 100;
        const paginationBtnSelector = selectors.paginationBtn(paginationIndex);
        let elapsed = 0;
        let loaded = false;
        let clicked = false;

        try {
            await page.waitForSelector(selectors.pagination, {timeout: timeout});
        }
        catch(err) {
            return {
                success: false,
                error: `Timeout on loading more jobs`
            };
        }

        while (!loaded) {
            if (!clicked) {
                clicked = await page.evaluate(
                    (selector) => {
                        const button = document.querySelector(selector);

                        if (button) {
                            button.click();
                            return true;
                        } else {
                            return false;
                        }
                    },
                    paginationBtnSelector
                );
            }

            loaded = await page.evaluate(
                (selector) => {
                    return document.querySelectorAll(selector).length > 0;
                },
                selectors.links,
            );

            if (loaded) return {success: true};

            await sleep(pollingTime);
            elapsed += pollingTime;

            if (elapsed >= timeout) {
                return {
                    success: false,
                    error: `Timeout on pagination`
                };
            }
        }

        return {success: true};
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
    ): Promise<void> => {
        let tag = `[${query.query}][${location}]`;
        let processed = 0;
        let paginationIndex = 1;

        // Set cookie
        logger.info("Setting authentication cookie");
        await page.setCookie({
            name: "li_at",
            value: process.env.LI_AT_COOKIE!,
            domain: ".www.linkedin.com"
        });

        logger.info(tag, "Opening", url);

        await page.goto(url, {
            waitUntil: 'networkidle2',
        });

        // Verify session
        if (!(await LoggedInRunStrategy._isAuthenticatedSession(page))) {
            logger.error("The provided session cookie is invalid. Check the documentation on how to obtain a valid session cookie.");
            this.scraper.emit(events.scraper.invalidSession);
            process.exit(1);
        }

        try {
            await page.waitForSelector(selectors.container, { timeout: 5000 });
        }
        catch(err) {
            logger.info(tag, `No jobs found, skip`);
            return;
        }

        // Try closing chat panel
        try {
            await page.evaluate((selector) => document.querySelector(selector).click(),
                selectors.toggleChatBtn);
        }
        catch (err) {
            logger.info(tag, "Failed to close chat panel");
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

            let jobIndex = 0;

            // Get number of all job links in the page
            let jobLinksTot = await page.evaluate(
                (linksSelector: string) => document.querySelectorAll(linksSelector).length,
                selectors.links
            );

            if (jobLinksTot === 0) {
                logger.info(tag, `No jobs found, skip`);
                break;
            }

            logger.info(tag, "Jobs fetched: " + jobLinksTot);

            // Jobs loop
            while (jobIndex < jobLinksTot && processed < query.options!.limit!) {
                tag = `[${query.query}][${location}][${processed + 1}]`;

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
                        selectors.links,
                        selectors.companies,
                        selectors.places,
                        selectors.dates,
                    ]);

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

                    // Try to load job details and extract job link
                    logger.debug(tag, 'Evaluating selectors', [
                        selectors.links,
                    ]);

                    [jobLink, loadDetailsResult] = await Promise.all([
                        page.evaluate((linksSelector: string, jobIndex: number) => {
                                const linkElem = <HTMLElement>document.querySelectorAll(linksSelector)[jobIndex];
                                linkElem.scrollIntoView();
                                linkElem.click();
                                const protocol = window.location.protocol + "//";
                                const hostname = window.location.hostname;
                                return protocol + hostname + linkElem.getAttribute("href");
                            },
                            selectors.links,
                            jobIndex
                        ),
                        LoggedInRunStrategy._loadJobDetails(page)
                    ]);

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
                catch(err) {
                    const errorMessage = `${tag}\t${err.message}`;
                    this.scraper.emit(events.scraper.error, errorMessage);
                    jobIndex++;
                    continue;
                }

                // Emit data
                this.scraper.emit(events.scraper.data, {
                    query: query.query || "",
                    location: location,
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

                if (processed < query.options!.limit! && jobIndex === jobLinksTot) {
                    logger.info(tag, 'Fecthing more jobs');
                    const fetched = await page.evaluate(
                        (linksSelector) => document.querySelectorAll(linksSelector).length,
                        selectors.links
                    );

                    if (fetched === jobLinksTot) {
                        logger.info(tag, "No more jobs available in this page");
                    }
                    else {
                        jobLinksTot = fetched;
                    }
                }
            }

            // Check if we reached the limit of jobs to process
            if (processed === query.options!.limit!) break;

            // Try pagination to load more jobs
            paginationIndex += 1;
            logger.info(tag, `Pagination requested (${paginationIndex})`);
            const paginationResult = await LoggedInRunStrategy._paginate(page, paginationIndex);

            // Check if loading jobs has failed
            if (!paginationResult.success) {
                logger.info(tag, paginationResult.error);
                logger.info(tag, "There are no more jobs available for the current query");
                break;
            }
        }
    }
}
