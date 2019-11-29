const { LinkedinScraper, events, } = require("../index");

(async () => {
    // Programatically disable logger
    setTimeout(() => LinkedinScraper.disableLogger(), 2000);

    // Each scraper instance is associated with one browser.
    // Concurrent queries will be runned on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    // Listen for custom events
    scraper.on(events.custom.data, ({ query, location, link, title, company, place, description, }) => {
        console.log(description);
    });

    const descriptionProcessor = () => document.querySelector(".description__text")
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

    // Run queries concurrently
    await Promise.all([
        scraper.run(
            "Node.js",
            "United Kingdom",
            {
                paginationMax: 2,
                descriptionProcessor,
            }
        ),
    ]);

    // Close browser
    await scraper.close();
})();
