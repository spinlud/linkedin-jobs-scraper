import {
    LinkedinScraper,
    events,
} from "..";

(async () => {
    // Each scraper instance is associated with one browser.
    // Concurrent queries will run on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 250,
        args: [
            "--remote-debugging-address=0.0.0.0",
            "--remote-debugging-port=9222",
        ],
    });

    // Add listeners for scraper events
    scraper.on(events.scraper.data, (data) => {
        console.log(data.description.length, data.title);
    });

    scraper.on(events.scraper.error, (error) => {
        console.error(error);
    });

    // Run queries concurrently
    await Promise.all([
        scraper.run({
            query: "Graphic",
            options: {
                locations: ["United States"],
                limit: 33,
                optimize: false,
            }
        }),

        scraper.run({
            query: "Engineer",
            options: {
                locations: ["Europe"],
                limit: 33,
                optimize: false,
            }
        }),
    ]);

    // Close browser
    await scraper.close();
})();
