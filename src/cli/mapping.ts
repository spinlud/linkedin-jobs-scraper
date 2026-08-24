/**
 * Pure translation from parsed CLI config into scraper domain objects.
 *
 * No I/O and no browser here: every function takes a CliConfig and returns plain domain values,
 * so the mapping can be exercised without launching Chrome.
 */
import { ScraperOptions } from "../scraper/Scraper";
import { IQuery, IQueryOptions, Location } from "../scraper/query";
import { CliConfig } from "./cli-config";
import {
    RELEVANCE_CHOICES,
    TIME_CHOICES,
    SALARY_CHOICES,
    TYPE_CHOICES,
    EXPERIENCE_CHOICES,
    WORKPLACE_CHOICES,
    INDUSTRY_CHOICES,
    JOB_FUNCTION_CHOICES,
    BENEFITS_CHOICES,
    COMMITMENTS_CHOICES,
    tokensToCodes,
} from "./filters";

type QueryFilters = NonNullable<IQueryOptions["filters"]>;

/** Map driver flags onto the scraper constructor options. */
export const buildScraperOptions = (config: CliConfig): ScraperOptions => {
    const options: ScraperOptions = {
        headless: !config.noHeadless,
        pacing: {
            baseDelay: config.baseDelay,
            adaptive: !config.noAdaptive,
        },
    };

    if (config.chromeExecutablePath) {
        options.executablePath = config.chromeExecutablePath;
    }

    // A profile directory is both the puppeteer user-data dir and the interactiveProfile auth
    // source. Without it, auth is left unset so the library falls back to the cookie env vars.
    if (config.chromeUserDataDir) {
        options.userDataDir = config.chromeUserDataDir;
        options.auth = { mode: "interactiveProfile", userDataDir: config.chromeUserDataDir };
    }

    return options;
};

/**
 * Map --location to plain strings and --geo-id to Location objects. The two are mutually
 * exclusive at the parser, so at most one list is populated. Returns undefined when neither is
 * given, letting the scraper apply its own default.
 */
export const buildLocations = (config: CliConfig): (string | Location)[] | undefined => {
    const locations: (string | Location)[] = [...config.location];
    for (const geoId of config.geoId) {
        locations.push(new Location(String(geoId)));
    }
    return locations.length ? locations : undefined;
};

/**
 * Human-readable location labels in the same order buildLocations produces them. Each --location
 * string appears as-is, then each --geo-id as 'geoId:<id>'. When neither is given the scraper
 * defaults to Worldwide, so a single 'Worldwide' label is returned.
 */
export const describeLocations = (config: CliConfig): string[] => {
    const labels = [...config.location];
    for (const geoId of config.geoId) {
        labels.push(`geoId:${geoId}`);
    }
    return labels.length ? labels : ["Worldwide"];
};

/** Build the filters object from only the filters the user actually provided. */
export const buildQueryFilters = (config: CliConfig): QueryFilters | undefined => {
    const filters: QueryFilters = {};

    if (config.companyJobsUrl !== undefined) {
        filters.companyJobsUrl = config.companyJobsUrl;
    }
    if (config.relevance !== undefined) {
        filters.relevance = RELEVANCE_CHOICES.codes[config.relevance];
    }
    if (config.time !== undefined) {
        filters.time = TIME_CHOICES.codes[config.time];
    }
    if (config.baseSalary !== undefined) {
        filters.baseSalary = SALARY_CHOICES.codes[config.baseSalary];
    }
    if (config.type.length) {
        filters.type = tokensToCodes(config.type, TYPE_CHOICES);
    }
    if (config.experience.length) {
        filters.experience = tokensToCodes(config.experience, EXPERIENCE_CHOICES);
    }
    if (config.onSiteOrRemote.length) {
        filters.onSiteOrRemote = tokensToCodes(config.onSiteOrRemote, WORKPLACE_CHOICES);
    }
    if (config.industry.length) {
        filters.industry = tokensToCodes(config.industry, INDUSTRY_CHOICES);
    }
    if (config.jobFunction.length) {
        filters.jobFunction = tokensToCodes(config.jobFunction, JOB_FUNCTION_CHOICES);
    }
    if (config.benefits.length) {
        filters.benefits = tokensToCodes(config.benefits, BENEFITS_CHOICES);
    }
    if (config.commitments.length) {
        filters.commitments = tokensToCodes(config.commitments, COMMITMENTS_CHOICES);
    }
    if (config.easyApply) {
        filters.easyApply = true;
    }
    if (config.under10Applicants) {
        filters.under10Applicants = true;
    }

    return Object.keys(filters).length ? filters : undefined;
};

/** Assemble the query options from the search options and filters. */
export const buildQueryOptions = (config: CliConfig): IQueryOptions => {
    const options: IQueryOptions = {
        limit: config.limit,
        applyLink: config.applyLink,
        skipPromotedJobs: config.skipPromotedJobs,
        pageOffset: config.pageOffset,
    };

    const locations = buildLocations(config);
    if (locations) {
        options.locations = locations;
    }

    const filters = buildQueryFilters(config);
    if (filters) {
        options.filters = filters;
    }

    return options;
};

/** Build the query for the jobs subcommand. */
export const buildQuery = (config: CliConfig): IQuery => ({
    query: config.query,
    options: buildQueryOptions(config),
});
