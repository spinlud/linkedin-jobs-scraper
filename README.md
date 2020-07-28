# linkedin-jobs-scraper
> Scrape public available job offers on Linkedin using headless browser (account credentials are not required).
> It is possible to run different queries on different locations concurrently. 
> For each job the following data fields are extracted: `title`, `company`, `place`, `date`, `link`, `description`, 
> `senorityLevel`, `jobFunction`, `employmentType`, `industries`.

## Table of Contents

<!-- toc -->

* [Installation](#installation)
* [Usage](#usage)
* [LinkedinScraper](#linkedinscraper)
* [Logger](#logger)
* [License](#license)

<!-- toc stop -->


## Installation
Install package:
```shell
npm install --save linkedin-jobs-scraper
```


## Usage 
```ts
import { LinkedinScraper, events, IData } from "linkedin-jobs-scraper";

(async () => {    
    // Each scraper instance is associated with one browser.
    // Concurrent queries will run on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    // Add listeners for scraper events
    scraper.on(events.scraper.data, (data: IData) => {
        console.log(
            data.description.length,
            `Query='${data.query}'`,
            `Location='${data.location}'`,
            `Title='${data.title}'`,
            `Company='${data.company}'`,
            `Place='${data.place}'`,
            `Date='${data.date}'`,
            `Link='${data.link}'`,
            `senorityLevel='${data.senorityLevel}'`,
            `function='${data.jobFunction}'`,
            `employmentType='${data.employmentType}'`,
            `industries='${data.industries}'`,
        );
    });

    scraper.on(events.scraper.error, (err) => { console.error(err); });
    scraper.on(events.scraper.end, () => { console.log('All done!'); });

    // Add listeners for puppeteer browser events
    scraper.on(events.puppeteer.browser.targetcreated, () => { });
    scraper.on(events.puppeteer.browser.targetchanged, () => { });
    scraper.on(events.puppeteer.browser.targetdestroyed, () => { });
    scraper.on(events.puppeteer.browser.disconnected, () => { });

    // Custom function executed on browser side to extract job description
    const descriptionProcessor = () => (<HTMLElement>document.querySelector(".description__text")!)
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

    // Run queries concurrently
    await Promise.all([
        scraper.run(
            "Graphic Designer",
            "London",
            {
                paginationMax: 2,
            }
        ),
        scraper.run(
            ["Developer", "Software Engineer"],
            ["San Francisco", "New York"],
            {
                paginationMax: 1,
                descriptionProcessor,
                optimize: true, // Block resources such as images, fonts etc to improve bandwidth usage
            }
        )
    ]);

    // Close browser
    await scraper.close();
})();
```


## LinkedinScraper
Each `LinkedinScraper` instance is associated with one browser (Chromium) instance. Concurrent runs will be executed
 on different pages within the same browser. Package uses [puppeteer](https://github.com/puppeteer/puppeteer) under the hood
 to instantiate Chromium browser instances; the same browser options and events are supported.
 For more informations about browser options see: [puppeteer-browser-options](https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions).
 For more information about browser events see: [puppeteer-browser-events](https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-class-browser).
 The main method is `run` which takes the following parameters:
 
* `queries` required, must be a string or an array of strings
* `locations` required, must be a string or an array of strings
* Optional object with the following:
    - `paginationMax` {Number} Maximum number of pagination
    - `descriptionProcessor` {Function} Function executed on browser side (you have access to `window`, `document`, etc) to extract job description
    - `optimize` {Boolean} Block resources such as images, stylesheets etc to improve bandwidth usage. Specifically the following resources are blocked:
        * image
        * stylesheet
        * media
        * font
        * texttrack
        * object
        * beacon
        * csp_report
        * imageset
 
```ts
import { LaunchOptions } from "puppeteer";

/**
 * Main class
 * @extends EventEmitter
 * @param options {LaunchOptions} Puppeteer launch options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 * @constructor
 */
constructor(options: LaunchOptions) { }

/**
 * Scrape linkedin jobs
 * @param queries {string | Array<string>}
 * @param locations {string | Array<string>}
 * @param options {IRunOptions}
 * @returns {Promise<void>}
 */
async run (
    queries: string | Array<string>,
    locations: string | Array<string>,
    options: IRunOptions
) => { }

/**
* Close browser instance
* @returns {Promise<void>}
*/
async close() { }

/**
 * Enable logger
 * @returns void
 * @static
 */
enableLogger() { }

/**
 * Disable logger
 * @returns void
 * @static
 */
disableLogger() { }

/**
 * Enable logger info namespace
 * @returns void
 * @static
 */
enableLoggerInfo() { }

/**
 * Enable logger error namespace
 * @returns void
 * @static
 */
enableLoggerError() { } 
```
  
## Logger
Logger uses [debug](https://github.com/visionmedia/debug) package under the hood. The following namespace are used:
* `scraper:info`
* `scraper:error`

Use environment variable `DEBUG` or the programmatic API to selectively enable/disable one or more namespace.

## License
[MIT License](http://en.wikipedia.org/wiki/MIT_License)
