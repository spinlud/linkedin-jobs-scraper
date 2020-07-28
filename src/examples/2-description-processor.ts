import { LinkedinScraper, events, IData } from "..";

(async () => {
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    scraper.on(events.scraper.data, (data: IData) => {
        console.log(data.date, data.description);
    });

    // Add listeners for scraper events
    scraper.on(events.scraper.error, (err) => { console.error(err); });
    scraper.on(events.scraper.end, () => { console.log('\nE N D (ツ)_.\\m/') });

    // Custom function executed on browser side to extract job description
    const descriptionProcessor = () => (<HTMLElement>document.querySelector(".description__text")!)
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

    await Promise.all([
        scraper.run(
            "Node.js",
            "United Kingdom",
            {
                paginationMax: 1,
                descriptionProcessor,
                optimize: true
            }
        ),
    ]);

    await scraper.close();
})();
