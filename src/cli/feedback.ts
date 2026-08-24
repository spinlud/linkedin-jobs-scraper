/**
 * Wire scraper events to the CLI output writer and to stderr feedback.
 *
 * DATA is routed to the output writer (stdout, owned by output.ts). Every other event becomes
 * human feedback on stderr through a Feedback object that also records the outcomes the entry
 * point turns into an exit code.
 */
import { LinkedinScraper } from "../scraper/LinkedinScraper";
import { events, IBegin, IData, IMetrics, INotFound } from "../scraper/events";
import { CliConfig } from "./cli-config";
import { Colorizer, colorEnabled } from "./color";
import { describeLocations } from "./mapping";
import { Spinner } from "./spinner";
import { Writer } from "./output";

// Left-hand label column width for the pre-run summary.
const ANNOUNCE_LABEL_WIDTH = 11;

const onOff = (value: boolean): string => (value ? "on" : "off");

const formatMetrics = (metrics: IMetrics): string =>
    `processed=${metrics.processed} failed=${metrics.failed} ` +
    `missed=${metrics.missed} skipped=${metrics.skipped} ` +
    `throttled=${metrics.throttled} pace=${metrics.pace}s`;

/**
 * Renders scraper lifecycle events onto a diagnostics stream and records outcomes.
 *
 * Informational events (begin, metrics progress, end summary, sessionRefreshed) obey --quiet;
 * error, notFound and invalidSession always print. Per-job metrics drive the animated spinner's
 * label; every standalone line is printed with the spinner cleared.
 */
export class Feedback {
    private _metrics: IMetrics | null = null;
    private _locationLabels: string[] = [];
    private _beginIndex = 0;
    public invalidSession = false;
    public notFound = false;

    constructor(
        private readonly _quiet: boolean,
        private readonly _write: (text: string) => void,
        private readonly _color: Colorizer,
        private readonly _spinner: Spinner,
    ) {}

    /** Provide the ordered location labels begin events are indexed against. */
    setLocationLabels(labels: string[]): void {
        this._locationLabels = [...labels];
        this._beginIndex = 0;
    }

    private _println(text: string): void {
        this._spinner.pause(() => {
            this._write(text + "\n");
        });
    }

    private _row(label: string, value: string): string {
        const padded = label.padEnd(ANNOUNCE_LABEL_WIDTH);
        return "   " + this._color.dim(padded) + value;
    }

    private _title(text: string): string {
        return "🔍 " + this._color.cyan(this._color.bold(text));
    }

    private _formatFilters(config: CliConfig): string {
        const segments: string[] = [];
        if (config.relevance !== undefined) {
            segments.push(`relevance=${config.relevance}`);
        }
        if (config.time !== undefined) {
            segments.push(`time=${config.time}`);
        }
        if (config.baseSalary !== undefined) {
            segments.push(`base-salary=${config.baseSalary}`);
        }
        if (config.companyJobsUrl !== undefined) {
            segments.push(`company-jobs-url=${config.companyJobsUrl}`);
        }
        if (config.type.length) {
            segments.push(`type=${config.type.join(",")}`);
        }
        if (config.experience.length) {
            segments.push(`experience=${config.experience.join(",")}`);
        }
        if (config.onSiteOrRemote.length) {
            segments.push(`on-site-or-remote=${config.onSiteOrRemote.join(",")}`);
        }
        if (config.industry.length) {
            segments.push(`industry=${config.industry.join(",")}`);
        }
        return segments.join(" ");
    }

    private _formatOptions(config: CliConfig): string {
        return (
            `apply-link=${onOff(config.applyLink)} ` +
            `skip-promoted=${onOff(config.skipPromotedJobs)} ` +
            `page-offset=${config.pageOffset}`
        );
    }

    private _formatDriver(config: CliConfig): string {
        const parts = [
            `headless=${onOff(!config.noHeadless)}`,
            `slow-mo=${config.baseDelay}s`,
            `adaptive=${onOff(!config.noAdaptive)}`,
        ];
        if (config.chromeUserDataDir) {
            parts.push(`profile=${config.chromeUserDataDir}`);
        }
        return parts.join(" ");
    }

    /** Print a compact, aligned summary of what is about to run, to the diagnostics stream. */
    announce(config: CliConfig): void {
        if (this._quiet) {
            return;
        }
        if (config.subcommand === "job") {
            this._println(this._title(`job ${config.urlOrId}`));
            this._println(this._row("options", `apply-link=${onOff(config.applyLink)}`));
            this._println(this._row("driver", this._formatDriver(config)));
            return;
        }

        this._println(this._title(config.query || "(no keywords)"));
        this._println(this._row("locations", describeLocations(config).join(", ")));
        this._println(this._row("limit", String(config.limit)));
        const filters = this._formatFilters(config);
        if (filters) {
            this._println(this._row("filters", filters));
        }
        this._println(this._row("options", this._formatOptions(config)));
        this._println(this._row("driver", this._formatDriver(config)));
    }

    onBegin = (begin: IBegin): void => {
        if (this._quiet) {
            return;
        }
        // Margin before every section but the first.
        if (this._beginIndex > 0) {
            this._println("");
        }

        let location: string | undefined;
        if (this._beginIndex < this._locationLabels.length) {
            location = this._locationLabels[this._beginIndex];
        }
        this._beginIndex += 1;

        const count =
            begin.jobTotal < 0 ? "results: unknown total" : `~${begin.jobTotal} results`;
        if (location !== undefined) {
            this._println(
                "📍 " + this._color.cyan(this._color.bold(location)) + "   " + count,
            );
        } else {
            this._println(count);
        }
        this._spinner.setLabel("searching…");
    };

    onMetrics = (metrics: IMetrics): void => {
        this._metrics = metrics;
        if (this._quiet) {
            return;
        }
        this._spinner.setLabel(formatMetrics(metrics));
    };

    onError = (error: Error | string): void => {
        const message = typeof error === "string" ? error : error.message;
        this._println("❌ " + this._color.red(`error: ${message}`));
    };

    onSessionRefreshed = (): void => {
        if (this._quiet) {
            return;
        }
        this._println("session refreshed");
    };

    onNotFound = (notFound: INotFound): void => {
        this.notFound = true;
        this._println("⚠️ " + this._color.yellow(`job not found: ${notFound.jobId}`));
    };

    onInvalidSession = (): void => {
        this.invalidSession = true;
        this._println("❌ " + this._color.red("error: session invalid or refused"));
    };

    onEnd = (): void => {
        this._spinner.stop();
        if (this._quiet) {
            return;
        }
        if (this._metrics !== null) {
            this._println("done: " + formatMetrics(this._metrics));
        } else {
            this._println("done");
        }
        this._println("");
    };
}

/** Build the stderr Feedback, keying colour off stderr being a tty. */
export const createFeedback = (config: CliConfig, spinner: Spinner): Feedback => {
    const colorizer = new Colorizer(colorEnabled(config.noColor, process.stderr));
    return new Feedback(
        config.quiet,
        (text: string) => {
            process.stderr.write(text);
        },
        colorizer,
        spinner,
    );
};

/** Route DATA to the output writer and every lifecycle event to the feedback object. */
export const registerEvents = (
    scraper: LinkedinScraper,
    writer: Writer,
    feedback: Feedback,
): void => {
    scraper.on(events.scraper.data, (data: IData) => writer.write(data));
    scraper.on(events.scraper.begin, feedback.onBegin);
    scraper.on(events.scraper.metrics, feedback.onMetrics);
    scraper.on(events.scraper.error, feedback.onError);
    scraper.on(events.scraper.sessionRefreshed, feedback.onSessionRefreshed);
    scraper.on(events.scraper.notFound, feedback.onNotFound);
    scraper.on(events.scraper.invalidSession, feedback.onInvalidSession);
    scraper.on(events.scraper.end, feedback.onEnd);
};
