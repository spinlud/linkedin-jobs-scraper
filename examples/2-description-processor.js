const { LinkedinScraper, events, } = require("../index");

(async () => {
    // Programatically disable logger
    setTimeout(() => LinkedinScraper.disableLogger(), 2000);

    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    scraper.on(events.custom.data, ({ query, location, link, title, company, place, description, }) => {
        console.log(description);
    });

    // Custom function executed on browser side to extract job description
    const descriptionProcessor = () => document.querySelector(".description__text")
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

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

    await scraper.close();
})();
