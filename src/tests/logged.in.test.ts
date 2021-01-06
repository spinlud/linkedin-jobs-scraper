import { IData } from "../scraper/events";
import { IQuery, IQueryOptions } from "../scraper/query";
import { killChromium } from "../utils/browser";
import {
    LinkedinScraper,
    timeFilter,
    relevanceFilter,
    experienceLevelFilter,
    events,
} from "..";

describe('[TEST]', () => {
    jest.setTimeout(240000);

    const onDataFn = (data: IData): void => {
        expect(data.query).toBeDefined();
        expect(data.location).toBeDefined();
        expect(data.jobId).toBeDefined();
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
        expect(data.jobId.length).toBeGreaterThan(0);
        expect(data.title.length).toBeGreaterThan(0);
        expect(data.place.length).toBeGreaterThan(0);
        expect(data.description.length).toBeGreaterThan(0);
        expect(data.descriptionHTML.length).toBeGreaterThan(0);

        expect(() => new URL(data.link)).not.toThrow();

        if (data.applyLink) {
            expect(() => new URL(data.applyLink!)).not.toThrow();
        }
    };

    const onErrorFn = (err: Error | string) => {
        console.error(err);
    };

    const onEndFn = () => {
        console.log("\nE N D (ツ)_.\\m/");
    }

    const queriesSerial1: IQuery[] = [
        {
            query: "c#",
            options: {
                locations: ['Finland'],
                limit: 50,
                filters: {
                    time: timeFilter.WEEK,
                }
            },
        },
        {
            query: 'Engineer',
            options: {
                limit: 27,
                filters: {
                    companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C10667&geoId=101165590&keywords=engineer&location=United%20Kingdom",
                },
            },
        },
    ];

    const globalOptions: IQueryOptions = {
        optimize: false,
        filters: {
            time: timeFilter.MONTH,
            relevance: relevanceFilter.RECENT,
        },
    };

    it('Logged-in strategy', async () => {
        expect(process.env.LI_AT_COOKIE).toBeDefined();
        expect(process.env.LI_AT_COOKIE!.length).toBeGreaterThan(0);

        const scraper = new LinkedinScraper({
            headless: true,
            args: [
                "--remote-debugging-address=0.0.0.0",
                "--remote-debugging-port=9222",
            ],
            slowMo: 200,
        });

        scraper.on(events.scraper.data, onDataFn);
        scraper.on(events.scraper.invalidSession, () => { console.error("Invalid session!"); });
        scraper.on(events.scraper.error, onErrorFn);
        scraper.on(events.scraper.end, onEndFn);

        try {
            await Promise.all([
                scraper.run(queriesSerial1, globalOptions),
                // scraper.run(queriesSerial2, globalOptions),
            ]);
        }
        finally {
            await scraper.close();
            await killChromium();
        }
    });
});
