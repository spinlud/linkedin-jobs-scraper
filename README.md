# linkedin-jobs-scraper
> Scrape public available jobs on Linkedin using headless browser. 
> For each job, the following fields are extracted: `jobId`, 
> `title`, 
> `company`,
> `[companyLink]`,
> `[companyImgLink]`,
> `place`, 
> `date`, 
> `link`, 
> `[applyLink]`,
> `description`, 
> `descriptionHTML`,
> `insights`. <br><br>
> It's also available an equivalent [package in python](https://github.com/spinlud/py-linkedin-jobs-scraper).

## Table of Contents

<!-- toc -->

* [Installation](#installation)
* [Usage](#usage)
* [LinkedinScraper](#linkedinscraper)
* [Anonymous vs authenticated session](#anonymous-vs-authenticated-session)
* [Rate limiting](#rate-limiting)
* [Filters](#filters)
* [Company filter](#company-filter)
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
const { 
    LinkedinScraper,
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    events,
} = require("linkedin-jobs-scraper");

(async () => {
    // Each scraper instance is associated with one browser.
    // Concurrent queries will run on different pages within the same browser instance.
    const scraper = new LinkedinScraper({
        headless: true,
        slowMo: 200,
        args: [
            "--lang=en-GB",
        ],
    });

    // Add listeners for scraper events
    
    // Emitted once for each processed job
    scraper.on(events.scraper.data, (data) => {
        console.log(
            data.description.length,
            data.descriptionHTML.length,
            `Query='${data.query}'`,
            `Location='${data.location}'`,
            `Id='${data.jobId}'`,
            `Title='${data.title}'`,
            `Company='${data.company ? data.company : "N/A"}'`,
            `CompanyLink='${data.companyLink ? data.companyLink : "N/A"}'`,
            `CompanyImgLink='${data.companyImgLink ? data.companyImgLink : "N/A"}'`,
            `Place='${data.place}'`,
            `Date='${data.date}'`,
            `Link='${data.link}'`,
            `applyLink='${data.applyLink ? data.applyLink : "N/A"}'`,
            `insights='${data.insights}'`,
        );
    });
    
    // Emitted once for each scraped page
    scraper.on(events.scraper.metrics, (metrics) => {
        // ...        
    });

    scraper.on(events.scraper.error, (err) => {
        console.error(err);
    });

    scraper.on(events.scraper.end, () => {
        console.log('All done!');
    });

    // Add listeners for puppeteer browser events [optional]
    scraper.on(events.puppeteer.browser.targetcreated, () => {
    });
    scraper.on(events.puppeteer.browser.targetchanged, () => {
    });
    scraper.on(events.puppeteer.browser.targetdestroyed, () => {
    });
    scraper.on(events.puppeteer.browser.disconnected, () => {
    });

    // Custom function executed on browser side to extract job description [optional]
    const descriptionFn = () => document.querySelector(".description__text")
        .innerText
        .replace(/[\s\n\r]+/g, " ")
        .trim();

    // Run queries concurrently    
    await Promise.all([
        // Run queries serially
        scraper.run([
            {
                query: "Engineer",
                options: {
                    locations: ["United States"], // This will override global options ["Europe"]
                    filters: {
                        type: [typeFilter.FULL_TIME, typeFilter.CONTRACT]    
                    },       
                }                                                       
            },
            {
                query: "Sales",
                options: {                    
                    limit: 10, // This will override global option limit (33)
                    applyLink: false, // Try to extract apply link. Default to true.
                }
            },
        ], { // Global options, will be merged individually with each query options
            locations: ["Europe"],
            limit: 33,
        }),
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
 


## Anonymous vs authenticated session
**⚠ WARNING: due to lack of time, anonymous session strategy is no longer maintained. If someone wants to keep
support for this feature and become a project maintainer, please be free to pm me.**

By default the scraper will run in anonymous mode (no authentication required). In some environments (e.g. AWS or Heroku) 
this may be not possible though. You may face the following error message:

```shell script
scraper:error [][] Scraper failed to run in anonymous mode, authentication may be necessary for this environment. Please check the documentation on how to use an authenticated session.
```

In that case the only option available is to run using an authenticated session. These are the steps required:
1. Login to LinkedIn using an account of your choice.
2. Open Chrome developer tools:

![](images/img3.png)

3. Go to tab `Application`, then from left panel select `Storage` -> `Cookies` -> `https://www.linkedin.com`. In the
main view locate row with name `li_at` and copy content from the column `Value`.

![](images/img4.png)

4. Set the environment variable `LI_AT_COOKIE` with the value obtained in step 3, then run your application as normal.
Example:

```shell script
LI_AT_COOKIE=<your li_at cookie value here> node app.js
```

## Rate limiting
You may experience the following rate limiting warning during execution: `429 too many requests`. This means you are 
exceeding the number of requests per second allowed by the server (this is especially true when using authenticated sessions
where the rate limits are much more strict). You can overcome this by:

- trying a higher `slowMo` value for the scraper options (this will slow down the browser); as a rule of thumb you can 
add 100 ms for each concurrent query (e.g. 100 for 1 query, 200 for 2 concurrent queries, 300 for 3 concurrent queries and so on);
- reducing the number of concurrent queries (make them to run in serial instead).

Example:

```js
const scraper = new LinkedinScraper({
    headless: true,
    slowMo: 200,
    args: [
        "--lang=en-GB",
    ],
});

// Two concurrent queries
await Promise.all([
    scraper.run([...]),
    scraper.run([...]),
]);
```


## Filters
It is possible to customize queries with the following filters:
- RELEVANCE:
    * `RELEVANT`
    * `RECENT`
- TIME:
    * `DAY`
    * `WEEK`
    * `MONTH`
    * `ANY`
- TYPE:
    * `FULL_TIME`
    * `PART_TIME`
    * `TEMPORARY`
    * `CONTRACT`
- EXPERIENCE LEVEL:
    * `INTERNSHIP`
    * `ENTRY_LEVEL`
    * `ASSOCIATE`
    * `MID_SENIOR`
    * `DIRECTOR`
- REMOTE:
    * `REMOTE` (supported only with authenticated session)
    
See the following example for more details:

```js
const { 
    LinkedinScraper,
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    remoteFilter,
    events,
} = require("linkedin-jobs-scraper");

(async () => {
    // [...]
    
    await scraper.run({
            query: "",
            options: {
                filters: {                    
                    relevance: relevanceFilter.RELEVANT,
                    time: timeFilter.MONTH,
                    type: [typeFilter.FULL_TIME, typeFilter.CONTRACT], // string or array
                    experience: [experienceLevelFilter.ENTRY_LEVEL, experienceLevelFilter.MID_SENIOR], // string or array
                    remote: remoteFilter.REMOTE, // supported only with authenticated session
                }
            }
        }, {         
            locations: ["United States"],
            limit: 10,
        });

    // [...]
})();
```

### Company Filter

It is also possible to filter by company using the public company jobs url on LinkedIn. To find this url you have to:
 1. Login to LinkedIn using an account of your choice.
 2. Go to the LinkedIn page of the company you are interested in (e.g. [https://www.linkedin.com/company/google](https://www.linkedin.com/company/google)).
 3. Click on `jobs` from the left menu.
 
 ![](images/img1.png)
 
 4. Scroll down and locate `See all jobs` or `See jobs` button.
 
 ![](images/img2.png)
 
 5. Right click and copy link address (or navigate the link and copy it from the address bar).
 6. Paste the link address in code as follows:
 
```js
// [...]

await scraper.run({
    query: "",
    options: {
        filters: {        
            // Copy link address here    
            companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C17876832%2C791962%2C2374003%2C18950635%2C16140%2C10440912&geoId=92000000&lipi=urn%3Ali%3Apage%3Acompanies_company_jobs_jobs%3BcbFm1gYoRwy%2FxVRQWbGyKw%3D%3D&licu=urn%3Ali%3Acontrol%3Ad_flagship3_company-see_all_jobs",            
        }
    }
});

// [...]
```
  
## Logger
Logger uses [debug](https://github.com/visionmedia/debug) package under the hood. The following namespace are used:
* `scraper:debug`
* `scraper:info`
* `scraper:warn`
* `scraper:error`

Use environment variable `DEBUG` or the programmatic API to selectively enable/disable one or more namespace.
Example:

```sh
DEBUG=scraper:info node app.js
```

## License
[MIT License](http://en.wikipedia.org/wiki/MIT_License)

If you like the project and want to contribute you can [donate something here](https://paypal.me/spinlud)! 
