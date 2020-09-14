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
            `query='${data.query}'`,
            `location='${data.location}'`,
            `title='${data.title}'`,
            `company='${data.company}'`,
            `place='${data.place}'`,
            `date='${data.date}'`,
            `link='${data.link}'`,
            `applyLink='${data.applyLink ? data.applyLink : "N/A"}'`,
            `senorityLevel='${data.senorityLevel}'`,
            `function='${data.jobFunction}'`,
            `employmentType='${data.employmentType}'`,
            `industries='${data.industries}'`,
        );
    });

    scraper.on(events.scraper.error, (err) => { console.error(err); });
    scraper.on(events.scraper.invalidSession, () => { /* Do something */ });
    scraper.on(events.scraper.end, () => { console.log("E N D (ツ)_.\\m/") });

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
        optimize: true,
        locations: ["New York"],
        limit: 33,
    });

    // Close browser
    await scraper.close();
})();
