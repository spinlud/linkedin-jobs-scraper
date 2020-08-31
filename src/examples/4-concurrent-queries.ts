import {
    LinkedinScraper,
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
        console.log(data.description.length, data.title);
    });

    // Run queries concurrently
    await Promise.all([
        scraper.run({
            query: "Graphic Designer",
            options: {
                locations: ["London"],
            }
        }),

        scraper.run({
            query: "Engineer",
            options: {
                locations: ["San Francisco"],
            }
        }),
    ]);

    // Close browser
    await scraper.close();
})();
