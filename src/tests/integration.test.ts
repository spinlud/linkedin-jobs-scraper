import {
    events,
    IData,
    LinkedinScraper,
    ERelevanceFilterOptions,
    ETimeFilterOptions,
} from "..";

describe('[TEST]', () => {
    jest.setTimeout(240000);

    it('Should run and terminate', async () => {
        const scraper = new LinkedinScraper({
            headless: false,
            slowMo: 15,
        });

        scraper.on(events.scraper.data, (data: IData) => {
            expect(data.description).toBeDefined();
            expect(data.query).toBeDefined();
            expect(data.location).toBeDefined();
            expect(data.title).toBeDefined();
            expect(data.company).toBeDefined();
            expect(data.place).toBeDefined();
            expect(data.date).toBeDefined();
            expect(data.link).toBeDefined();
            expect(data.senorityLevel).toBeDefined();
            expect(data.jobFunction).toBeDefined();
            expect(data.employmentType).toBeDefined();
            expect(data.industries).toBeDefined();
        });

        scraper.on(events.scraper.error, (err) => { console.error(err); });
        scraper.on(events.scraper.end, () => { console.log('\nE N D (ツ)_.\\m/') });

        const descriptionProcessor = () => (<HTMLElement>document.querySelector(".description__text")!)
            .innerText
            .replace(/[\s\n\r]+/g, " ")
            .trim();

        await Promise.all([
            scraper.run(
                ['Designer', 'Architect'],
                'Japan',
                { paginationMax: 1 }
            ),
            scraper.run(
                "Node.js",
                "United Kingdom",
                {
                    paginationMax: 2,
                    descriptionProcessor,
                    filter: {
                        relevance: ERelevanceFilterOptions.RECENT,
                        time: ETimeFilterOptions.DAY,
                    },
                    optimize: true,
                }
            ),
        ]);

        await scraper.close();
    });
});
