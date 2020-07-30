import {events, IData, LinkedinScraper} from "..";
import { ERelevanceFilterOptions, ETimeFilterOptions } from "../scraper/filters";

(async () => {
    const scraper = new LinkedinScraper({
        headless: false,
        slowMo: 10,
    });

    // Add listeners for scraper events
    scraper.on(events.scraper.data, (data: IData) => {
        console.log(
            data.description.length,
            `Query='${data.query}'`,
            `Location='${data.location}'`,
            `Title='${data.title}'`,
            `Company='${data.company}'`,
            `Place='${data.place}'`,
            `Date='${data.date}'`,
            `Link='${data.link}'`,
            `senorityLevel='${data.senorityLevel}'`,
            `function='${data.jobFunction}'`,
            `employmentType='${data.employmentType}'`,
            `industries='${data.industries}'`,
        );
    });

    scraper.on(events.scraper.error, (err) => { console.error(err); });
    scraper.on(events.scraper.end, () => { console.log('\nE N D (ツ)_.\\m/') });

    // Run queries concurrently
    await Promise.all([
        scraper.run(
            "Sound Engineer",
            ["New York"],
            {
                paginationMax: 2,
                filter: {
                    relevance: ERelevanceFilterOptions.RECENT,
                    time: ETimeFilterOptions.MONTH
                }
            }
        )
    ]);

    // Close browser
    await scraper.close();
})();
