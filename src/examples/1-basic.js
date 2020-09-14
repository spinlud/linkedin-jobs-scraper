const {
    LinkedinScraper,
    events,
    ETimeFilterOptions,
    EExperienceLevelOptions,
} = require("../../build/index");

(async () => {
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 20,
        args: [
            "--remote-debugging-address=0.0.0.0",
            "--remote-debugging-port=9222",
        ],
    });

    scraper.on(events.scraper.data, (data) => {
        console.log(data.description.length, data.title, data.industries);
    });

    scraper.on(events.scraper.error, (error) => {
        console.error(error);
    });

    await Promise.all([
        scraper.run([
            {
                query: "Engineer",
                options: {
                    locations: ["Europe"],
                    optimize: false,
                    limit: 37,
                }
            },
        ], {
            optimize: false,
            limit: 33,
        }),

        scraper.run(
            {
                query: "Director",
                options: {
                    filters: {
                        experience: EExperienceLevelOptions.DIRECTOR,
                    },
                    optimize: false,
                    limit: 33,
                }
            }
        ),
    ]);

    await scraper.close();
})();
