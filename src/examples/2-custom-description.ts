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
        console.log(data.description);
    });

    // Custom function to process job description (executed on browser side)
    const descriptionFn = () => (<HTMLElement>document.querySelector(".description__text")!)
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

    await scraper.run({
        query: "Software Engineer",
        options: {
            descriptionFn: descriptionFn,
        }
    }, {
        optimize: true,
        locations: ["New York"],
        limit: 33,
    });

    // Close browser
    await scraper.close();
})();

