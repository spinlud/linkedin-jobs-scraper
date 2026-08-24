#!/usr/bin/env node
/**
 * Command line entry point: parse, build, dispatch.
 *
 * The CLI holds no scraping logic. It parses arguments with commander, reduces them onto a typed
 * CliConfig, configures the library logger, and dispatches to the jobs, job, or login command.
 */
import * as fs from "fs";
import * as path from "path";
import { Command, Option } from "commander";
import { LinkedinScraper } from "../scraper/LinkedinScraper";
import {
    CliConfig,
    DEFAULT_BASE_DELAY_SECONDS,
    DEFAULT_LIMIT,
    DEFAULT_PAGE_LOAD_TIMEOUT_SECONDS,
    DEFAULT_PAGE_OFFSET,
    Subcommand,
} from "./cli-config";
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
    ChoiceMap,
    commaSeparatedChoice,
    singleChoice,
} from "./filters";
import { runJobs } from "./commands/jobs";
import { runJob } from "./commands/job";
import { runLogin } from "./commands/login";

const PROGRAM_NAME = "linkedin-jobs-scraper";

interface GlobalOptions {
    color: boolean;
    quiet?: boolean;
    verbose: number;
}

interface DriverOptions {
    headless: boolean;
    baseDelay: number;
    adaptive: boolean;
    pageLoadTimeout: number;
    chromeExecutablePath?: string;
    chromeUserDataDir?: string;
    interactiveLogin?: boolean;
}

interface OutputOptions {
    outFormat?: string;
    outPath?: string;
    fields?: string;
    allFields?: boolean;
    vertical?: boolean;
    raw?: boolean;
}

interface SearchOptions {
    location: string[];
    geoId: string[];
    limit: number;
    applyLink?: boolean;
    skipPromotedJobs?: boolean;
    pageOffset: number;
    relevance?: string;
    time?: string;
    baseSalary?: string;
    companyJobsUrl?: string;
    type?: string[];
    experience?: string[];
    onSiteOrRemote?: string[];
    industry?: string[];
    jobFunction?: string[];
    benefits?: string[];
    commitments?: string[];
    easyApply?: boolean;
    under10Applicants?: boolean;
}

type JobsOptions = GlobalOptions & DriverOptions & OutputOptions & SearchOptions;
type JobOptions = GlobalOptions & DriverOptions & OutputOptions & { applyLink?: boolean };
interface LoginOptions extends GlobalOptions {
    chromeUserDataDir: string;
    chromeExecutablePath?: string;
}

/** Read the version from this package's package.json, the single source. */
const packageVersion = (): string => {
    try {
        const raw = fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8");
        const parsed: { version?: string } = JSON.parse(raw);
        return parsed.version ?? "unknown";
    } catch (err) {
        return "unknown";
    }
};

const parseFloatArg = (value: string): number => Number.parseFloat(value);
const parseIntArg = (value: string): number => Number.parseInt(value, 10);
const appendString = (value: string, previous: string[]): string[] => [...previous, value];
const countVerbose = (_value: string, previous: number): number => previous + 1;

const addGlobalOptions = (command: Command): void => {
    command
        .option("--no-color", "Disable coloured output")
        .option("--quiet", "Suppress non-error output")
        .option("-v, --verbose", "Increase verbosity (repeatable)", countVerbose, 0);
};

const addDriverOptions = (command: Command): void => {
    command
        .option("--no-headless", "Run Chrome with a visible window")
        .option(
            "--base-delay <seconds>",
            "Floor on seconds slept between jobs",
            parseFloatArg,
            DEFAULT_BASE_DELAY_SECONDS,
        )
        .option("--no-adaptive", "Keep the delay fixed instead of adapting to 429s")
        // Accepted for Python CLI parity; the library exposes no page-load timeout knob yet.
        .option(
            "--page-load-timeout <seconds>",
            "Page load timeout in seconds",
            parseIntArg,
            DEFAULT_PAGE_LOAD_TIMEOUT_SECONDS,
        )
        .option("--chrome-executable-path <path>", "Path to the Chrome executable")
        .option("--chrome-user-data-dir <dir>", "Chrome profile directory kept across runs")
        .option("--interactive-login", "Sign in by hand into the profile before scraping");
};

const addOutputOptions = (command: Command): void => {
    command
        .addOption(
            new Option("-f, --out-format <format>", "Output format").choices([
                "table",
                "jsonl",
                "json",
                "csv",
            ]),
        )
        .option("-o, --out-path <path>", "Output destination; '-' means stdout")
        .option("--fields <fields>", "Comma-separated list of fields to emit")
        .option("--all-fields", "Emit every available field")
        .option("--vertical", "Render one field per line")
        .option("--raw", "Emit the raw record unformatted");
};

const addSearchOptions = (command: Command): void => {
    command
        .option("--location <name>", "Location name (repeatable)", appendString, [])
        .option("--geo-id <id>", "LinkedIn geoId (repeatable)", appendString, [])
        .option("--limit <n>", "Maximum jobs to scrape, 0 for unlimited", parseIntArg, DEFAULT_LIMIT)
        .option("--apply-link", "Resolve the external apply link for each job")
        .option("--skip-promoted-jobs", "Skip promoted jobs")
        .option("--page-offset <n>", "Number of result pages to skip", parseIntArg, DEFAULT_PAGE_OFFSET)
        .option("--relevance <value>", "Sort order", singleChoice("--relevance", RELEVANCE_CHOICES))
        .option("--time <value>", "Time posted", singleChoice("--time", TIME_CHOICES))
        .option(
            "--base-salary <value>",
            "Minimum base salary",
            singleChoice("--base-salary", SALARY_CHOICES),
        )
        .option("--company-jobs-url <url>", "LinkedIn company jobs url for the company filter")
        .option(
            "--type <type>",
            enumHelp("Job type", TYPE_CHOICES),
            commaSeparatedChoice("--type", TYPE_CHOICES),
        )
        .option(
            "--experience <level>",
            enumHelp("Experience level", EXPERIENCE_CHOICES),
            commaSeparatedChoice("--experience", EXPERIENCE_CHOICES),
        )
        .option(
            "--on-site-or-remote <mode>",
            enumHelp("On-site/remote", WORKPLACE_CHOICES),
            commaSeparatedChoice("--on-site-or-remote", WORKPLACE_CHOICES),
        )
        .option(
            "--industry <industry>",
            enumHelp("Industry", INDUSTRY_CHOICES),
            commaSeparatedChoice("--industry", INDUSTRY_CHOICES),
        )
        .option(
            "--job-function <function>",
            enumHelp("Job function", JOB_FUNCTION_CHOICES),
            commaSeparatedChoice("--job-function", JOB_FUNCTION_CHOICES),
        )
        .option(
            "--benefits <benefit>",
            enumHelp("Benefits", BENEFITS_CHOICES),
            commaSeparatedChoice("--benefits", BENEFITS_CHOICES),
        )
        .option(
            "--commitments <commitment>",
            enumHelp("Commitments", COMMITMENTS_CHOICES),
            commaSeparatedChoice("--commitments", COMMITMENTS_CHOICES),
        )
        .option("--easy-apply", "Only jobs with LinkedIn Easy Apply")
        .option("--under-10-applicants", "Only jobs with fewer than 10 applicants");
};

const enumHelp = (label: string, choices: ChoiceMap): string =>
    `${label}, repeatable or comma-separated: ${choices.order.join(", ")}`;

/** Split the --fields value into trimmed, non-empty field names. */
const parseFields = (fields: string | undefined): string[] | undefined => {
    if (!fields) {
        return undefined;
    }
    const names = fields
        .split(",")
        .map(name => name.trim())
        .filter(name => name.length > 0);
    return names.length ? names : undefined;
};

interface MergedGlobals {
    noColor: boolean;
    quiet: boolean;
    verbose: number;
}

const mergeGlobals = (programOpts: GlobalOptions, commandOpts: GlobalOptions): MergedGlobals => ({
    noColor: !(programOpts.color && commandOpts.color),
    quiet: Boolean(programOpts.quiet) || Boolean(commandOpts.quiet),
    verbose: (programOpts.verbose ?? 0) + (commandOpts.verbose ?? 0),
});

/** Configure the library logger from the verbosity count, unless LOG_LEVEL pins it explicitly. */
const configureLogger = (verbose: number): void => {
    if (process.env["LOG_LEVEL"]) {
        return;
    }
    if (verbose >= 2) {
        LinkedinScraper.enableLoggerDebug();
    } else if (verbose === 1) {
        LinkedinScraper.enableLoggerInfo();
    } else {
        LinkedinScraper.enableLoggerWarn();
    }
};

const failConfig = (message: string): never => {
    process.stderr.write(`error: ${message}\n`);
    return process.exit(2);
};

const buildBaseConfig = (
    subcommand: Subcommand,
    globals: MergedGlobals,
    driver: DriverOptions,
): CliConfig => ({
    subcommand,
    quiet: globals.quiet,
    verbose: globals.verbose,
    noColor: globals.noColor,
    noHeadless: !driver.headless,
    baseDelay: driver.baseDelay,
    noAdaptive: !driver.adaptive,
    pageLoadTimeout: driver.pageLoadTimeout,
    chromeExecutablePath: driver.chromeExecutablePath,
    chromeUserDataDir: driver.chromeUserDataDir,
    interactiveLogin: Boolean(driver.interactiveLogin),
    outFormat: undefined,
    outPath: undefined,
    fields: undefined,
    allFields: false,
    vertical: false,
    raw: false,
    query: "",
    location: [],
    geoId: [],
    limit: DEFAULT_LIMIT,
    applyLink: false,
    skipPromotedJobs: false,
    pageOffset: DEFAULT_PAGE_OFFSET,
    relevance: undefined,
    time: undefined,
    baseSalary: undefined,
    companyJobsUrl: undefined,
    type: [],
    experience: [],
    onSiteOrRemote: [],
    industry: [],
    jobFunction: [],
    benefits: [],
    commitments: [],
    easyApply: false,
    under10Applicants: false,
    urlOrId: "",
});

const applyOutputOptions = (config: CliConfig, output: OutputOptions): void => {
    config.outFormat = output.outFormat;
    config.outPath = output.outPath;
    config.fields = parseFields(output.fields);
    config.allFields = Boolean(output.allFields);
    config.vertical = Boolean(output.vertical);
    config.raw = Boolean(output.raw);
};

const main = async (): Promise<void> => {
    // Short-circuit --version before any dispatch, printing this package's version.
    if (process.argv.slice(2).includes("--version")) {
        process.stdout.write(`${PROGRAM_NAME} ${packageVersion()}\n`);
        process.exit(0);
    }

    const program = new Command();
    program
        .name(PROGRAM_NAME)
        .description("Scrape public LinkedIn job postings from the command line.");
    addGlobalOptions(program);

    const jobs = program.command("jobs [query]").description("Search and scrape jobs");
    addGlobalOptions(jobs);
    addDriverOptions(jobs);
    addOutputOptions(jobs);
    addSearchOptions(jobs);
    jobs.action(async (query: string | undefined, options: JobsOptions) => {
        const globals = mergeGlobals(program.opts<GlobalOptions>(), options);
        configureLogger(globals.verbose);

        if (options.location.length > 0 && options.geoId.length > 0) {
            failConfig("--location and --geo-id are mutually exclusive");
        }
        if (options.interactiveLogin && !options.chromeUserDataDir) {
            failConfig("--interactive-login requires --chrome-user-data-dir");
        }

        const config = buildBaseConfig("jobs", globals, options);
        applyOutputOptions(config, options);
        config.query = query ?? "";
        config.location = options.location;
        config.geoId = options.geoId;
        config.limit = options.limit;
        config.applyLink = Boolean(options.applyLink);
        config.skipPromotedJobs = Boolean(options.skipPromotedJobs);
        config.pageOffset = options.pageOffset;
        config.relevance = options.relevance;
        config.time = options.time;
        config.baseSalary = options.baseSalary;
        config.companyJobsUrl = options.companyJobsUrl;
        config.type = options.type ?? [];
        config.experience = options.experience ?? [];
        config.onSiteOrRemote = options.onSiteOrRemote ?? [];
        config.industry = options.industry ?? [];
        config.jobFunction = options.jobFunction ?? [];
        config.benefits = options.benefits ?? [];
        config.commitments = options.commitments ?? [];
        config.easyApply = Boolean(options.easyApply);
        config.under10Applicants = Boolean(options.under10Applicants);

        process.exit(await runJobs(config));
    });

    const job = program.command("job <url-or-id>").description("Scrape a single job by url or id");
    addGlobalOptions(job);
    addDriverOptions(job);
    addOutputOptions(job);
    job.option("--apply-link", "Resolve the external apply link for the job");
    job.action(async (urlOrId: string, options: JobOptions) => {
        const globals = mergeGlobals(program.opts<GlobalOptions>(), options);
        configureLogger(globals.verbose);

        if (options.interactiveLogin && !options.chromeUserDataDir) {
            failConfig("--interactive-login requires --chrome-user-data-dir");
        }

        const config = buildBaseConfig("job", globals, options);
        applyOutputOptions(config, options);
        config.urlOrId = urlOrId;
        config.applyLink = Boolean(options.applyLink);

        process.exit(await runJob(config));
    });

    const login = program
        .command("login")
        .description("Sign in once into a reusable Chrome profile");
    addGlobalOptions(login);
    login.requiredOption("--chrome-user-data-dir <dir>", "Chrome profile directory to create or reuse");
    login.option("--chrome-executable-path <path>", "Path to the Chrome executable");
    login.action(async (options: LoginOptions) => {
        const globals = mergeGlobals(program.opts<GlobalOptions>(), options);
        configureLogger(globals.verbose);

        const config = buildBaseConfig("login", globals, {
            headless: true,
            baseDelay: DEFAULT_BASE_DELAY_SECONDS,
            adaptive: true,
            pageLoadTimeout: DEFAULT_PAGE_LOAD_TIMEOUT_SECONDS,
            chromeExecutablePath: options.chromeExecutablePath,
            chromeUserDataDir: options.chromeUserDataDir,
        });

        process.exit(await runLogin(config));
    });

    await program.parseAsync(process.argv);
};

void main();
