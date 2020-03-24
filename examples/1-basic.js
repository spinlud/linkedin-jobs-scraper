const { LinkedinScraper, events, } = require("../index");

(async () => {
    // Programatically disable logger
    setTimeout(() => LinkedinScraper.disableLogger(), 5000);

    // Each scraper instance is associated with one browser.
    // Concurrent queries will be runned on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: false,
        slowMo: 10,
    });

    // Listen for custom events
    scraper.on(events.custom.data, ({ query, location, link, title, company, place, description, }) => {
        console.log(
            description.length,
            `Query='${query}'`,
            `Location='${location}'`,
            `Title='${title}'`,
            `Company='${company}'`,
            `Place='${place}'`,
            `Link='${link}'`,
        );
    });

    scraper.on(events.custom.error, (err) => { });
    scraper.on(events.custom.end, () => { });

    // Listen for puppeteer specific browser events
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
