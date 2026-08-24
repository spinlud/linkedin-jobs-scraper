/**
 * Typed view of the parsed command line, one flat record for every subcommand.
 *
 * The commands consume this instead of raw commander option objects, so the mapping onto
 * scraper domain objects and the feedback rendering can be exercised without a parser.
 */

export const DEFAULT_BASE_DELAY_SECONDS = 0.8;
export const DEFAULT_PAGE_LOAD_TIMEOUT_SECONDS = 20;
export const DEFAULT_LIMIT = 25;
export const DEFAULT_PAGE_OFFSET = 0;

export type Subcommand = "jobs" | "job" | "login";

export interface CliConfig {
    subcommand: Subcommand;

    // Global
    quiet: boolean;
    verbose: number;
    noColor: boolean;

    // Driver
    noHeadless: boolean;
    baseDelay: number;
    noAdaptive: boolean;
    pageLoadTimeout: number;
    chromeExecutablePath?: string;
    chromeUserDataDir?: string;
    interactiveLogin: boolean;

    // Output
    outFormat?: string;
    outPath?: string;
    fields?: string[];
    allFields: boolean;
    vertical: boolean;
    raw: boolean;

    // jobs
    query: string;
    location: string[];
    geoId: string[];
    limit: number;
    applyLink: boolean;
    skipPromotedJobs: boolean;
    pageOffset: number;
    relevance?: string;
    time?: string;
    baseSalary?: string;
    companyJobsUrl?: string;
    type: string[];
    experience: string[];
    onSiteOrRemote: string[];
    industry: string[];
    jobFunction: string[];
    benefits: string[];
    commitments: string[];
    easyApply: boolean;
    under10Applicants: boolean;

    // job
    urlOrId: string;
}
