# linkedin-jobs-scraper
> Scrape public available jobs on Linkedin using a headless browser.

* 🔑 **Session management**: long running session with auto recovery
* 🐢 **Adaptive rate limiting**: auto adjust scraping speed to avoid rate limiting
* 📄 **Fields parser**: `jobId`, `link`, `applyLink`, `title`, `company`, `companyLink`, `companyEmployeeCount`, `companyImgLink`, `place`, `description`, `descriptionHTML`, `date`, `dateText`, `insights`, `salary`, `isEasyApply`, `applicantCount`, `benefits`, `reposted`
* 🔍 **Filters**: relevance, time, type, experience, industry, salary, remote, company
* 📡 **Events hooks**: data, metrics, errors
* 🚀 **Headless support**: can run in background
* ⌨️ **Command line interface**: scrape straight from your shell, no code required
* 🟢 **Programmatic API**: drive it from Node.js (TypeScript) with full control

> It's also available an equivalent [package in python](https://github.com/spinlud/py-linkedin-jobs-scraper).

> [!WARNING]
> For personal or educational use only. All extracted data is publicly available on LinkedIn and remains
> owned by LinkedIn. I am not responsible for any inappropriate use of data extracted through this library.

## Table of Contents

<!-- toc -->

* [Requirements](#requirements)
* [Installation](#installation)
* [Usage](#usage)
  * [CLI](#cli)
  * [Programmatic](#programmatic)
  * [Pinning a location by geoId](#pinning-a-location-by-geoid)
* [Authentication](#authentication)
* [Adaptive Rate limiting](#adaptive-rate-limiting)
* [Filters](#filters)
* [Company filter](#company-filter)
* [Logging](#logging)
* [License](#license)

<!-- toc stop -->


## Requirements
- [Chrome](https://www.google.com/intl/en_us/chrome/) or [Chromium](https://www.chromium.org/getting-involved/download-chromium)
- Node >= 22

Puppeteer automatically downloads a matching Chromium on install. You can also point the scraper at
a Chrome/Chromium you already have (any option other than `pacing` and `auth` is forwarded to
`puppeteer.launch`):

```ts
const scraper = new LinkedinScraper({
    executablePath: '/path/to/chrome',
});
```


## Installation
Install package:
```shell
npm install --save linkedin-jobs-scraper
```


## Usage

Both a command line interface and a Node.js API are supported. Before your first scrape you need to authenticate once. The quickest way is the CLI:

```sh
lijs login --chrome-user-data-dir ~/.linkedin-jobs-scraper
```

See [Authentication](#authentication) for all the options (Chrome profile, cookie pair, headless
machines).

### CLI

Installing the package also installs a command line interface. It mirrors the programmatic API but
scrapes a single query per invocation.

Two equivalent commands are installed:

```sh
linkedin-jobs-scraper --help   # full command
lijs --help                    # short alias
```

Without a global install you can invoke it through `npx`:

```sh
npx linkedin-jobs-scraper --help
```

#### Subcommands

#### `jobs`
Search jobs matching the provided query, locations and filters:

```sh
lijs jobs "software engineer" --location "United States" --location "Remote" --limit 50 --chrome-user-data-dir <path>
lijs jobs "data scientist" --geo-id 103644278 --time week --type full-time,contract \
  --experience mid-senior --on-site-or-remote remote --base-salary 120k --apply-link --chrome-user-data-dir <path>
```

- Positional `query` — the search keywords.
- `--location NAME` (repeatable) or `--geo-id ID` (repeatable) — mutually exclusive; a geoId
  pins the search deterministically (see [Pinning a location by geoId](#pinning-a-location-by-geoid)).
- `--limit N` — maximum jobs to scrape, `0` for unlimited (default `25`).
- `--apply-link` — resolve the external apply link for each job (slower).
- `--skip-promoted-jobs` — skip promoted jobs.
- `--page-offset N` — number of result pages to skip (default `0`).

Filters use kebab-case values. Single-valued: `--relevance {relevant,recent}`,
`--time {any,day,week,month}`, `--base-salary {40k,60k,80k,100k,120k,140k,160k,180k,200k}`,
`--company-jobs-url URL`. Repeatable or comma-separated: `--type` (`full-time`, `part-time`,
`temporary`, `contract`, `internship`, `volunteer`, `other`), `--experience` (`internship`,
`entry-level`, `associate`, `mid-senior`, `director`, `executive`), `--on-site-or-remote`
(`on-site`, `remote`, `hybrid`), `--industry` (e.g. `software-development`, `banking`,
`it-services`), `--job-function` (e.g. `engineering`, `sales`, `information-technology`),
`--benefits` (e.g. `medical`, `vision`, `dental`), `--commitments` (e.g. `work-life-balance`,
`social-impact`). Boolean toggles: `--easy-apply` (only LinkedIn Easy Apply jobs),
`--under-10-applicants` (only jobs with fewer than 10 applicants). Run
`lijs jobs --help` for the full list of values.

#### `job`
Lookup a single job id or a `/jobs/view/<id>` url, with an optional `--apply-link`:

```sh
lijs job 3690634839 --chrome-user-data-dir <path>
lijs job https://www.linkedin.com/jobs/view/3690634839 --apply-link --chrome-user-data-dir <path>
```

#### `login`

```sh
linkedin-jobs-scraper login --chrome-user-data-dir ~/.linkedin-jobs-scraper
```

Opens a visible browser to sign in once into a reusable Chrome profile, then prints the reuse
commands and the remember-me cookie pair ready to export. Requires `--chrome-user-data-dir`; also
accepts `--chrome-executable-path`.

#### Driver flags

Shared by `jobs` and `job`: `--no-headless`, `--base-delay SECONDS`, `--no-adaptive`,
`--page-load-timeout SECONDS`, `--chrome-executable-path PATH`, `--chrome-user-data-dir DIR`,
`--interactive-login`.

#### Output

DATA is written to **stdout**; progress, metrics and errors go to **stderr**, so piping the data
stream stays clean.

- `-f`, `--out-format {table,jsonl,json,csv}` — output format.
- `-o`, `--out-path PATH` — destination; `-` means stdout.
- `--fields a,b,c` — comma-separated list of fields to emit.
- `--all-fields` — emit every available field.
- `--vertical` — render one field per line.
- `--raw` — emit the raw record unformatted.

When `--out-format` is omitted the format is inferred from the `--out-path` extension (`.csv`,
`.json`, `.jsonl`); with no path it defaults to `table` on a TTY and `jsonl` when piped or written
to a file.

In the `table` format on a TTY, URL fields (`link`, `applyLink`, `companyLink`, `companyImgLink`)
are rendered as clickable terminal hyperlinks (OSC 8): columns show a compact label while clicking
opens the full URL. Structured formats (`jsonl`/`json`/`csv`) always carry the full, unmodified URLs.

In the `table` format on a TTY, cell values are colour-coded per column to make rows easier to
scan; `--no-color` (or the `NO_COLOR` environment variable) disables it.

#### Global flags

`--quiet`, `-v`/`-vv` (repeatable, increases verbosity), `--no-color`, `--version`. `--no-color` is
accepted on every subcommand, before or after it.

#### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Generic error |
| `2` | Invalid or refused session |
| `3` | Job not found (`job`) |

### Programmatic

```ts
import {
    LinkedinScraper,
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    onSiteOrRemoteFilter,
    baseSalaryFilter,
    Location,
    events,
} from "linkedin-jobs-scraper";

(async () => {
    // Each scraper instance is associated with one browser. Concurrent queries run on different
    // pages within the same browser instance. Any option other than `pacing` and `auth` is
    // forwarded to puppeteer.launch.
    const scraper = new LinkedinScraper({
        headless: true,
        pacing: {
            baseDelay: 0.8,   // Floor on seconds slept between jobs, to avoid 'Too many requests 429'. Min 0.2, default 0.8
            adaptive: true,   // Slow down automatically when LinkedIn throttles the run, then ease back. See 'Adaptive Rate limiting'
        },
        args: [
            "--lang=en-GB",
        ],
    });

    // Fired once per query/location before scraping starts, carrying LinkedIn's approximate
    // total result count (jobTotal is -1 when it could not be parsed)
    scraper.on(events.scraper.begin, (begin) => {
        console.log("[ON_BEGIN]", begin.jobTotal);
    });

    // Fired once for each successfully processed job
    scraper.on(events.scraper.data, (data) => {
        console.log("[ON_DATA]", data.title, data.company, data.companyLink, data.date, data.dateText,
            data.link, data.insights, data.description.length);
    });

    // Fired once for each page (25 jobs)
    scraper.on(events.scraper.metrics, (metrics) => {
        console.log("[ON_METRICS]",
            `processed=${metrics.processed}`,
            `failed=${metrics.failed}`,
            `missed=${metrics.missed}`,
            `skipped=${metrics.skipped}`,
            `throttled=${metrics.throttled}`,
            `pace=${metrics.pace}s`,
        );
    });

    scraper.on(events.scraper.error, (error) => {
        console.error("[ON_ERROR]", error);
    });

    scraper.on(events.scraper.end, () => {
        console.log("[ON_END]");
    });

    await scraper.run([
        {
            options: {
                limit: 27,  // Limit the number of jobs to scrape. Use 0 to scrape all available jobs (LinkedIn serves up to ~1000).
            },
        },
        {
            query: "Engineer",
            options: {
                locations: ["Europe", new Location("103644278", "United States")],  // Plain name, or pin a geo by geoId. See 'Pinning a location by geoId'
                applyLink: true,       // Try to extract the apply link (easy applies are skipped). Slower, because an extra page is navigated. Default false
                skipPromotedJobs: true, // Skip promoted jobs. Default false
                pageOffset: 2,          // How many pages to skip
                limit: 5,
                filters: {
                    companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C17876832%2C791962%2C2374003%2C18950635%2C16140%2C10440912&geoId=92000000",  // Filter by companies
                    relevance: relevanceFilter.RECENT,
                    time: timeFilter.MONTH,
                    type: [typeFilter.FULL_TIME, typeFilter.INTERNSHIP],
                    onSiteOrRemote: [onSiteOrRemoteFilter.REMOTE],
                    experience: [experienceLevelFilter.MID_SENIOR],
                    baseSalary: baseSalaryFilter.SALARY_100K,
                },
            },
        },
    ]);

    // Close browser
    await scraper.close();
})();
```

#### Additional data fields

Alongside the core fields, each `data` event also carries:

* `salary`: pay range when LinkedIn shows one (from the fit-level insight or the salary rail card), otherwise `undefined`.
* `isEasyApply`: `true` when the listing uses LinkedIn Easy Apply, `false` for an external apply flow.
* `applicantCount`: the applicant segment of the top card (e.g. `'27 applicants'`), otherwise `undefined`.
* `benefits`: list of featured benefit labels, `undefined` when none are shown.
* `reposted`: `true` when the listing was reposted (derived from the date text).

`date` is an ISO `YYYY-MM-DD` string. It comes from the card's exact `<time datetime>` when
available, otherwise it is approximated from the relative date text (weeks, months and years
approximated at 7, 30 and 365 days), and is `''` only when no date text could be parsed.

#### Scraping a single job

When you already know the job you want, `scrapeJob` fetches it directly by url or id, bypassing
search and pagination. It accepts a bare numeric id, a full `/jobs/view/<id>` url, or a
`?currentJobId=<id>` url, emits a single `data` event on success, and an `error` event (without
raising) on failure. A dead or expired id, one that points to a job that no longer exists, emits a
`notFound` event (carrying `{ jobId }`) rather than `error`, since a missing job is not a scraping
error.

```ts
import { LinkedinScraper, events } from "linkedin-jobs-scraper";

(async () => {
    const scraper = new LinkedinScraper({
        headless: true,
        pacing: { baseDelay: 0.8 },
    });

    scraper.on(events.scraper.data, (data) => {
        console.log("[ON_DATA]", data.title, data.company, data.companyLink, data.dateText, data.link,
            data.insights, data.description.length);
    });

    scraper.on(events.scraper.error, (error) => {
        console.error("[ON_ERROR]", error);
    });

    scraper.on(events.scraper.notFound, (data) => {
        console.log("[ON_NOT_FOUND]", data.jobId);
    });

    // By bare id
    await scraper.scrapeJob("4455383771");

    // Or by full url
    await scraper.scrapeJob("https://www.linkedin.com/jobs/view/4455383771/");

    // Pass applyLink=true to also extract the external apply link (slower)
    await scraper.scrapeJob("4455383771", { applyLink: true });

    await scraper.close();
})();
```

The single-job path reads every field from the job detail panel, so a few card-only fields are not
populated: `companyImgLink` and the promoted flag. `date` has no exact `<time datetime>` here, so
it is approximated from `dateText`. `query`, `location` are empty and `jobIndex` is `-1`, as
there is no search context.

### Pinning a location by geoId

A location entry can be a plain string (a place name LinkedIn resolves for you) or a `Location`
that pins the geo deterministically through LinkedIn's own `geoId`:

```ts
import { Location } from "linkedin-jobs-scraper";

new Location("103644278", "United States");
```

`geoId` is what pins the search: it is sent as the `geoId` URL param, and the `location=<name>`
param is omitted entirely (LinkedIn lets `geoId` win over a name in a conflict). `name` is only a
human label — it is used for logs and set on the `data` event's `location` field — so it can be
anything, or left out (the `geoId` is then used as the label).

To find a real `geoId`, run the search on LinkedIn in a browser, then read the `geoId=` value from
the resolved URL.

## Authentication

The scraper needs a LinkedIn session. The **recommended and tested** way is a Chrome profile on a local machine (see below). The cookie-based modes are supported alternatives, but LinkedIn may refuse them in some environments (for example CI or a server), so they are not guaranteed everywhere. All modes keep the session alive on their own, so a long run is not interrupted when LinkedIn expires it.

|  | Chrome profile (recommended) | Cookie pair |
| --- | --- | --- |
| Runs on | A machine with a display | No display needed (may be refused in some environments) |
| Setup | Sign in once, in a browser window | Two environment variables |
| Lasts | As long as the profile is kept | About a year |
| Concurrency | One browser per profile directory | Unrestricted |

Each mode can also be passed explicitly through the `auth` scraper option instead of the
environment: `{ mode: "interactiveProfile", userDataDir }`, `{ mode: "rememberMe", liRm, bcookie }`,
or `{ mode: "liAt", liAt }`.

### 1. Chrome profile

Sign in once into a Chrome profile that the scraper then reuses:

```sh
linkedin-jobs-scraper login --chrome-user-data-dir ~/.linkedin-jobs-scraper
```

A browser window opens on the sign in page. Sign in there, ticking **"Keep me logged in"** — that
is what makes the profile reusable. The password is typed into the browser: nothing in this
package reads, stores or transmits it.

Then point the scraper at the same profile:

```ts
const scraper = new LinkedinScraper({
    auth: { mode: "interactiveProfile", userDataDir: "~/.linkedin-jobs-scraper" },
});
```

To skip the separate command and have the first run do the sign in instead, use
`--interactive-login` on the CLI (`jobs`/`job`), which requires `--chrome-user-data-dir` and a
display, and waits up to 10 minutes for a human. Leave it off anywhere nobody is watching, such as
CI or a server. Chrome locks a profile directory, so a given profile is used by a single browser at
a time.

### 2. Cookie pair

You can use LinkedIn's remember me cookies (`li_rm` and `bcookie`) as environment variables to obtain a session, an option when a browser window is not available (you still need a machine with a browser window to obtain them the first time). Both variables are required. LinkedIn may refuse this mode in some environments (for example CI), so it is not guaranteed everywhere; prefer the Chrome profile when you can.

```sh
export LI_RM_COOKIE='<li_rm value>'
export LI_BCOOKIE='<bcookie value>' # keep the double quote " characters the value contains
node app.js
```

Get the two values by running the sign in command above on a machine that has a display: it
prints them at the end, quoted and ready to export.

> [!WARNING]
> Do not copy these two cookies out of your browser's developer tools:
> use the sign in command described above instead.

Setting `--chrome-user-data-dir` (or `auth.userDataDir`) as well is worth it if the host has storage that survives across runs:
the session is then reused instead of being requested again at the start of each run.

### Fallback: a bare session cookie

`LI_AT_COOKIE` takes the `li_at` session cookie on its own. This one can be copied straight out of your own Chrome browser. Sign in, then open Chrome developer
tools:

![](media/img3.png)

Go to tab `Application`, then from the left panel select `Storage` -> `Cookies` ->
`https://www.linkedin.com`, locate the row named `li_at` and copy the `Value` column.

![](media/img4.png)

```sh
LI_AT_COOKIE=<your li_at cookie value here> node app.js
```

This cookie cannot be renewed: LinkedIn expires it after a while, and a run that
loses it stops. Expect to replace it by hand. As with the cookie pair, LinkedIn may refuse it in some environments; prefer the Chrome profile when you can.

### Begin event

`begin` (`scraper:begin`) fires once per query/location, before any job is scraped, carrying an
approximate total result count for that search. `jobTotal` is `-1` when the count could not be
parsed. Combined with `limit: 0` (scrape all available jobs, LinkedIn serves up to ~1000), it lets
a caller know upfront roughly how many results a query has:

```ts
scraper.on(events.scraper.begin, (begin) => {
    console.log("total results reported by LinkedIn:", begin.jobTotal);
});
```

### Session events

`sessionRefreshed` (`scraper:session-refreshed`) fires whenever the scraper ends up holding a
session cookie different from the one it was given. Listen to it if you have nowhere else to store a
session and want to reuse it on the next run:

```ts
scraper.on(events.scraper.sessionRefreshed, (session) => {
    console.log("store this for the next run:", session.liAt);
});
```

`invalidSession` (`scraper:invalid-session`) fires when every credential supplied was refused,
immediately before the run aborts with `InvalidCookieException`. It takes no arguments:

```ts
scraper.on(events.scraper.invalidSession, () => {
    console.log("LinkedIn refused every credential");
});
```

### Not found event

`notFound` (`scraper:not-found`) fires when a single-job scrape (`scrapeJob`) targets a job that
does not exist or is no longer available. It carries `{ jobId }` for the id that was requested.
Throttling and page-load failures stay a silent skip, since neither says anything about whether the
job exists:

```ts
scraper.on(events.scraper.notFound, (data) => {
    console.log("job no longer available:", data.jobId);
});
```

## Adaptive Rate limiting

Requests failing with the status code 429 mean you are sending too many requests and LinkedIn is
throttling them. Pacing is controlled by the `pacing` option:

- `baseDelay`: seconds slept between jobs. Higher is safer, at least `0.2`, default `0.8`.
- `adaptive`: when `true` (default), `baseDelay` is only the fastest the run will ever go.

`baseDelay` sets the fastest the run will ever go, not a fixed delay: with `adaptive` on
(the default) the run starts at that speed and slows itself down whenever LinkedIn pushes back.

- **On every 429**, the delay between jobs doubles, up to `min(10, baseDelay * 10)` seconds.
- **After 20 jobs in a row without a 429**, the delay eases back towards `baseDelay`, and never
  goes below it.

Pass `adaptive: false` to make `baseDelay` a fixed delay instead.

There is no `max_workers` knob: a single scraper drives one browser and processes a run's locations
sequentially behind a single pacer (LinkedIn rate-limits per account). If you still hit throttling,
reduce the number of concurrent queries.

The `metrics` event reports both numbers:

- `throttled`: how many 429s the run has met.
- `pace`: the delay currently slept between jobs.

## Filters

It is possible to customize queries with the following filters:
- RELEVANCE:
    * `RELEVANT`
    * `RECENT`
- TIME:
    * `ANY`
    * `DAY`
    * `WEEK`
    * `MONTH`
- TYPE:
    * `FULL_TIME`
    * `PART_TIME`
    * `TEMPORARY`
    * `CONTRACT`
    * `INTERNSHIP`
    * `VOLUNTEER`
    * `OTHER`
- EXPERIENCE LEVEL:
    * `INTERNSHIP`
    * `ENTRY_LEVEL`
    * `ASSOCIATE`
    * `MID_SENIOR`
    * `DIRECTOR`
    * `EXECUTIVE`
- ON SITE OR REMOTE:
    * `ON_SITE`
    * `REMOTE`
    * `HYBRID`
- INDUSTRY:
    * `AIRLINES_AVIATION`
    * `BANKING`
    * `CIVIL_ENGINEERING`
    * `COMPUTER_GAMES`
    * `ENVIRONMENTAL_SERVICES`
    * `ELECTRONIC_MANUFACTURING`
    * `FINANCIAL_SERVICES`
    * `INFORMATION_SERVICES`
    * `INVESTMENT_BANKING`
    * `INVESTMENT_MANAGEMENT`
    * `IT_SERVICES`
    * `LEGAL_SERVICES`
    * `MOTOR_VEHICLES`
    * `OIL_GAS`
    * `SOFTWARE_DEVELOPMENT`
    * `STAFFING_RECRUITING`
    * `TECHNOLOGY_INTERNET`
- BASE SALARY:
    * `SALARY_40K`
    * `SALARY_60K`
    * `SALARY_80K`
    * `SALARY_100K`
    * `SALARY_120K`
    * `SALARY_140K`
    * `SALARY_160K`
    * `SALARY_180K`
    * `SALARY_200K`
- JOB FUNCTION:
    * `ACCOUNTING_AUDITING`
    * `ADMINISTRATIVE`
    * `ADVERTISING`
    * `BUSINESS_DEVELOPMENT`
    * `CONSULTING`
    * `DISTRIBUTION`
    * `DESIGN`
    * `EDUCATION`
    * `ENGINEERING`
    * `FINANCE`
    * `GENERAL_BUSINESS`
    * `HEALTH_CARE_PROVIDER`
    * `HUMAN_RESOURCES`
    * `INFORMATION_TECHNOLOGY`
    * `LEGAL`
    * `MANAGEMENT`
    * `MANUFACTURING`
    * `MARKETING`
    * `OTHER`
    * `PUBLIC_RELATIONS`
    * `PRODUCT_MANAGEMENT`
    * `PROJECT_MANAGEMENT`
    * `QUALITY_ASSURANCE`
    * `RESEARCH`
    * `SALES`
    * `SUPPLY_CHAIN`
    * `TRAINING`
- BENEFITS:
    * `MEDICAL`
    * `VISION`
    * `DENTAL`
    * `RETIREMENT_401K`
    * `PENSION_PLAN`
    * `PAID_MATERNITY_LEAVE`
    * `PAID_PATERNITY_LEAVE`
    * `COMMUTER_BENEFITS`
    * `STUDENT_LOAN_ASSISTANCE`
    * `TUITION_ASSISTANCE`
    * `DISABILITY_INSURANCE`
- COMMITMENTS:
    * `DIVERSITY_EQUITY_INCLUSION`
    * `ENVIRONMENTAL_SUSTAINABILITY`
    * `WORK_LIFE_BALANCE`
    * `SOCIAL_IMPACT`
    * `CAREER_GROWTH_AND_LEARNING`
- EASY APPLY: `easyApply: true` restricts results to jobs with LinkedIn Easy Apply.
- UNDER 10 APPLICANTS: `under10Applicants: true` restricts results to jobs with fewer than 10 applicants.
- COMPANY:
    * See below

The package root exports the `relevanceFilter`, `timeFilter`, `typeFilter`, `experienceLevelFilter`,
`onSiteOrRemoteFilter`, `baseSalaryFilter`, `industryFilter`, `jobFunctionFilter`, `benefitsFilter`
and `commitmentsFilter` constants, so every filter can be referenced by name rather than by its raw
LinkedIn code (the CLI exposes the same filters as `--industry`, `--job-function`, `--benefits` and
`--commitments`).

See the following example for more details:

```ts
import {
    LinkedinScraper,
    relevanceFilter,
    timeFilter,
    typeFilter,
    experienceLevelFilter,
    onSiteOrRemoteFilter,
    industryFilter,
    baseSalaryFilter,
    jobFunctionFilter,
    benefitsFilter,
    commitmentsFilter,
} from "linkedin-jobs-scraper";

const query = {
    query: "Engineer",
    options: {
        locations: ["United States"],
        applyLink: true,
        skipPromotedJobs: true,
        limit: 5,
        filters: {
            relevance: relevanceFilter.RECENT,
            time: timeFilter.MONTH,
            type: [typeFilter.FULL_TIME, typeFilter.INTERNSHIP],
            experience: [experienceLevelFilter.INTERNSHIP, experienceLevelFilter.MID_SENIOR],
            onSiteOrRemote: [onSiteOrRemoteFilter.REMOTE],
            industry: [industryFilter.IT_SERVICES],
            baseSalary: baseSalaryFilter.SALARY_100K,
            jobFunction: [jobFunctionFilter.ENGINEERING],
            benefits: [benefitsFilter.MEDICAL, benefitsFilter.VISION],
            commitments: [commitmentsFilter.WORK_LIFE_BALANCE],
            easyApply: true,
            under10Applicants: true,
        },
    },
};
```

### Industry Filter

If you need an industry that is not listed in `industryFilter`, you can pass its raw LinkedIn code
directly. To find the numeric code for the industry:
 1. Perform the search on LinkedIn in a browser, with the industry filter applied.
 2. The numeric code is in the URL, immediately after `f_I`. For example the URL
https://www.linkedin.com/jobs/search/?currentJobId=3661007408&distance=25&f_E=3%2C4&f_I=43%2C46%2C41%2C45&f_JT=F%2CC&geoId=102257491&keywords=Product%20Owner&refresh=true contains text `f_I=43%2C46%2C41%2C45` indicating a filter is applied on industry codes 43, 46, 41 and 45.

### Company Filter

It is also possible to filter by company using the public company jobs url on LinkedIn. To find this url you have to:
 1. Login to LinkedIn using an account of your choice.
 2. Go to the LinkedIn page of the company you are interested in (e.g. [https://www.linkedin.com/company/google](https://www.linkedin.com/company/google)).
 3. Click on `jobs` from the left menu.

 ![](media/img1.png)


 4. Scroll down and locate `See all jobs` or `See jobs` button.

 ![](media/img2.png)

 5. Right click and copy link address (or navigate the link and copy it from the address bar).
 6. Paste the link address in code as follows:

```ts
const query = {
    options: {
        filters: {
            // Paste link below
            companyJobsUrl: "https://www.linkedin.com/jobs/search/?f_C=1441%2C17876832%2C791962%2C2374003%2C18950635%2C16140%2C10440912&geoId=92000000",
        },
    },
};
```

## Logging
Logger uses the [debug](https://github.com/visionmedia/debug) package under the hood, with namespace
root `scraper`. The following namespaces are used:
* `scraper:debug`
* `scraper:info`
* `scraper:warn`
* `scraper:error`

Use the environment variable `DEBUG` to selectively enable/disable one or more namespaces. When
`DEBUG` is unset, `info`, `warn` and `error` are enabled by default. Example:

```sh
DEBUG=scraper:info node app.js   # only info
DEBUG=scraper:* node app.js      # everything
```

## License
[MIT License](http://en.wikipedia.org/wiki/MIT_License)

If you like the project and want to contribute you can [donate something here](https://paypal.me/spinlud)!
