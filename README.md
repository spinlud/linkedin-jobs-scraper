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
* [Events](#events)
* [Logger](#logger)
* [License](#license)

<!-- toc stop -->


## Installation
Install package:
```shell
npm install --save linkedin-jobs-scraper
```


## Usage 
```js
const { LinkedinScraper, events, } = require("linkedin-jobs-scraper");

(async () => {
    // Programatically disable logger
    setTimeout(() => LinkedinScraper.disableLogger(), 5000);

    // Each scraper instance is associated with one browser.
    // Concurrent queries will be runned on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 10,
    });

    // Listen for custom events
    scraper.on(events.custom.data, ({ query, location, link, title, company, place, date, description, }) => {
        console.log(
            description.length,
            `Query='${query}'`,
            `Location='${location}'`,
            `Title='${title}'`,
            `Company='${company}'`,
            `Place='${place}'`,
            `Date='${date}'`,
            `Link='${link}'`,
            `senorityLevel='${senorityLevel}'`,
            `function='${jobFunction}'`,
            `employmentType='${employmentType}'`,
            `industries='${industries}'`,
        );
    });

    scraper.on(events.custom.error, (err) => { console.error(err); });
    scraper.on(events.custom.end, () => { console.log('All done!'); });

    // Listen for puppeteer specific browser events
    scraper.on(events.puppeteer.browser.targetcreated, () => { });
    scraper.on(events.puppeteer.browser.targetchanged, () => { });
    scraper.on(events.puppeteer.browser.targetdestroyed, () => { });
    scraper.on(events.puppeteer.browser.disconnected, () => { });

    // This will be executed on browser side
    const descriptionProcessor = () => document.querySelector(".description__text")
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
 
```js
/**
 * Constructor
 * @extends EventEmitter
 * @param options {Object} Puppeteer browser options, for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions
 */
constructor(options) { }

/**
 * Scrape linkedin jobs
 * @param queries Array[String] of queries
 * @param locations Array[String] of locations
 * @param [paginationMax] {Number} Max number of pagination
 * @param [descriptionProcessor] {Function} Custom function to extract job description on browser side
 * @returns {Promise<void>}
 */
async run(
    queries,
    locations,
    {
        paginationMax,
        descriptionProcessor,
    } = {
        paginationMax: 10,
        descriptionProcessor: null,
    },    
) { }

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


## Events
```js
// Emitted when a job is processed
linkedinScraper.on("data", ({ query, location, link, title, company, place, description, }) => {});
 
// Emitted in case of an error
linkedinScraper.on("error", (err) => {});

// Emitted at the end of a run
linkedinScraper.on("end", () => {});

// Puppeteer browser events: for more informations see https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-class-browser
linkedinScraper.on("disconnected", () => {});
linkedinScraper.on("targetchanged", () => {});
linkedinScraper.on("targetcreated", () => {});
linkedinScraper.on("targetdestroyed", () => {});
```
  
## Logger
Logger uses [debug](https://github.com/visionmedia/debug) package under the hood. The following namespace are used:
* `scraper:info`
* `scraper:error`

Use environment variable `DEBUG` or the programmatic API to selectively enable/disable one or more namespace.

## License
[MIT License](http://en.wikipedia.org/wiki/MIT_License)
