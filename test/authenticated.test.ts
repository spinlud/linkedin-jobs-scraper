import { IData } from "../src/scraper/events";
import { IQuery, IQueryOptions } from "../src/scraper/query";
import { killChromium } from "../src/utils/browser";
import { sleep } from '../src/utils/utils';
import {
    LinkedinScraper,
    timeFilter,
    relevanceFilter,
    experienceLevelFilter,
    events,
} from "../src";

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

        if (data.companyLink) {
            expect(() => new URL(data.companyLink!)).not.toThrow();
        }

        if (data.companyImgLink) {
            expect(() => new URL(data.companyImgLink!)).not.toThrow();
        }
    };

    const descriptionFn = () => (<HTMLElement>document.querySelector(".jobs-description")!)
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

    const scraper = new LinkedinScraper({
        headless: true,
        args: [
            "--remote-debugging-address=0.0.0.0",
            "--remote-debugging-port=9222",
        ],
        slowMo: 200,
    });

    afterEach(async () => {
        // Necessary to avoid Jest error: `ReferenceError: You are trying to `import` a file after the Jest environment has been torn down.`
        await sleep(2000);
    });

    const queriesSerial1: IQuery[] = [
        {
            query: '',
        },
        {
            query: "c#",
            options: {
                locations: ['Finland'],
                optimize: true,
                limit: 33,
                descriptionFn,
                filters: {
                    time: timeFilter.WEEK,
                    experience: experienceLevelFilter.MID_SENIOR,
                }
            },
        },
        {
            query: 'Engineer',
            options: {
                locations: ['United States'],
                limit: 27,
                filters: {
                    companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C10667&geoId=101165590&keywords=engineer&location=United%20Kingdom",
                },
            },
        },
    ];

    const globalOptions: IQueryOptions = {
        limit: 10,
        locations: ['United Kingdom'],
        filters: {
            time: timeFilter.MONTH,
            relevance: relevanceFilter.RECENT,
        },
    };

    it('Authenticated strategy',  async () => {
        expect(process.env.LI_AT_COOKIE).toBeDefined();
        expect(process.env.LI_AT_COOKIE!.length).toBeGreaterThan(0);

        scraper.on(events.scraper.data, onDataFn);
        scraper.on(events.scraper.invalidSession, () => { console.error("Invalid session!") });
        scraper.on(events.scraper.error, (err) => { console.error(err) });
        scraper.on(events.scraper.end, () => console.log("\nE N D (ツ)_.\\m/"));

        await scraper.run(queriesSerial1, globalOptions);
        await scraper.close();
        await killChromium();
    });
});
