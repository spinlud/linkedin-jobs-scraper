import { LinkedinScraper, events, IData } from "..";

(async () => {
    // Programatically disable logger
    setTimeout(() => LinkedinScraper.disableLogger(), 5000);

    // Each scraper instance is associated with one browser.
    // Concurrent queries will run on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    // Listen for custom events
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

    // Add listeners for scraper events
    scraper.on(events.scraper.error, (err) => { console.error(err); });
    scraper.on(events.scraper.end, () => { console.log('\nE N D (ツ)_.\\m/') });

    // Add listeners for puppeteer specific browser events
    scraper.on(events.puppeteer.browser.targetcreated, () => { });
    scraper.on(events.puppeteer.browser.targetchanged, () => { });
    scraper.on(events.puppeteer.browser.targetdestroyed, () => { });
    scraper.on(events.puppeteer.browser.disconnected, () => { });

    // Run queries concurrently
    await Promise.all([
        scraper.run(
            "Graphic Designer",
            ["Berlin", "London"],
            {
                paginationMax: 2,
            }
        ),
        scraper.run(
            ["Developer", "Software Engineer"],
            ["San Francisco", "New York"],
            {
                paginationMax: 1,
            }
        ),
    ]);

    // Close browser
    await scraper.close();
})();
