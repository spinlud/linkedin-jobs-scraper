import {
    LinkedinScraper,
    events,
} from "..";

(async () => {
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    // Add listeners for scraper events
    scraper.on(events.scraper.data, (data) => {
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

    // Add listeners for puppeteer specific browser events
    scraper.on(events.puppeteer.browser.targetcreated, () => { });
    scraper.on(events.puppeteer.browser.targetchanged, () => { });
    scraper.on(events.puppeteer.browser.targetdestroyed, () => { });
    scraper.on(events.puppeteer.browser.disconnected, () => { });

    await scraper.run({
        query: "Graphic Designer",
        options: {
            locations: ["London"], // This will override the global options
        }
    }, {
        optmize: true,
        locations: ["New York"],
        limit: 33,
    });

    // Close browser
    await scraper.close();
})();
