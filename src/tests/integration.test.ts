import {
    LinkedinScraper,
    ETimeFilterOptions,
    ERelevanceFilterOptions,
    EExperienceLevelOptions,
    events,
} from "..";

describe('[TEST]', () => {
    jest.setTimeout(240000);

    it('Should run and terminate graciously', async () => {
        const scraper = new LinkedinScraper({
            headless: true,
            args: [
                "--remote-debugging-address=0.0.0.0",
                "--remote-debugging-port=9222",
            ],
            slowMo: 300,
        });

        scraper.on(events.scraper.data, (data) => {
            expect(data.query).toBeDefined();
            expect(data.location).toBeDefined();
            expect(data.title).toBeDefined();
            expect(data.company).toBeDefined();
            expect(data.place).toBeDefined();
            expect(data.date).toBeDefined();
            expect(data.description).toBeDefined();
            expect(data.descriptionHTML).toBeDefined();
            expect(data.link).toBeDefined();
            expect(data.senorityLevel).toBeDefined();
            expect(data.jobFunction).toBeDefined();
            expect(data.employmentType).toBeDefined();
            expect(data.industries).toBeDefined();

            expect(data.location.length).toBeGreaterThan(0);
            expect(data.title.length).toBeGreaterThan(0);
            expect(data.place.length).toBeGreaterThan(0);
            expect(data.description.length).toBeGreaterThan(0);
            expect(data.descriptionHTML.length).toBeGreaterThan(0);

            expect(() => new URL(data.link)).not.toThrow();

            if (data.applyLink) {
                expect(() => new URL(data.applyLink!)).not.toThrow();
            }
        });

        scraper.on(events.scraper.error, (err) => { console.error(err); });
        scraper.on(events.scraper.invalidSession, () => { console.error("Invalid session!"); });
        scraper.on(events.scraper.end, () => { console.log("\nE N D (ツ)_.\\m/") });

        const descriptionFn = () => (<HTMLElement>document.querySelector(".jobs-description")!)
            .innerText
            .replace(/[\s\n\r]+/g, " ")
            .trim();

        await Promise.all([
            scraper.run([
                    {
                        query: "",
                        options: {
                            optimize: false,
                            limit: 27,
                            descriptionFn: descriptionFn
                        },
                    },
                    {
                        query: "Designer",
                        options: {
                            limit: 27,
                            descriptionFn: descriptionFn
                        },
                    },
                ], {
                    filters: {
                        time: ETimeFilterOptions.MONTH
                    }
                }
            ),

            scraper.run(
                {
                    query: 'Engineer',
                    options: {
                        filters: {
                            companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C10667&geoId=101165590&keywords=engineer&location=United%20Kingdom",
                        },
                    },
                },
                {
                    limit: 27,
                    locations: ["United States", "United Kingdom"],
                    filters: {
                        relevance: ERelevanceFilterOptions.RECENT,
                    },
                    optimize: false,
                }
            ),
        ]);

        await scraper.close();
    });
});
