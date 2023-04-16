import {
    LinkedinScraper,
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    events,
} from "..";

(async () => {
    // Each scraper instance is associated with one browser.
    // Concurrent queries will run on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    // Add listeners for scraper events
    scraper.on(events.scraper.data, (data) => {
        console.log(
            `Title: ${data.title} \n
            Company: ${data.company} \n
            filters ${data?.options?.filters ? JSON.stringify(data.options.filters) : ""}`
        );
    });

    await scraper.run({
        query: "",
        options: {
            filters: {
                // See documentation on how find this url
                companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C17876832%2C791962%2C2374003%2C18950635%2C16140%2C10440912&geoId=92000000&lipi=urn%3Ali%3Apage%3Acompanies_company_jobs_jobs%3BcbFm1gYoRwy%2FxVRQWbGyKw%3D%3D&licu=urn%3Ali%3Acontrol%3Ad_flagship3_company-see_all_jobs",
                relevance: relevanceFilter.RELEVANT,
                time: timeFilter.MONTH,
                // type: typeFilter.FULL_TIME,
                experience: experienceLevelFilter.MID_SENIOR,
            }
        }
    }, {
        optimize: true,
        locations: ["United States"],
        limit: 10,
    });

    // Close browser
    await scraper.close();
})();
