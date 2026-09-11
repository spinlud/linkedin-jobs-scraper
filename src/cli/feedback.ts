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

// An all-zero snapshot for locations that produced no metrics, keeping rows and totals defined.
const zeroMetrics = (): IMetrics => ({
    processed: 0,
    failed: 0,
    missed: 0,
    skipped: 0,
    throttled: 0,
    pace: 0,
});

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
    private _locationSummaries: Array<{ label: string | null; metrics: IMetrics | null }> = [];
    private _currentLocation: string | null = null;
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

    private _rowPadded(label: string, padWidth: number, value: string): string {
        const padded = label.padEnd(padWidth);
        return "   " + this._color.dim(padded) + "  " + value;
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
            `base-delay=${config.baseDelay}s`,
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
        // Snapshot the finished location before advancing. This bookkeeping runs even under
        // --quiet; only the printing below is gated.
        if (this._currentLocation !== null) {
            this._locationSummaries.push({
                label: this._currentLocation,
                metrics: this._metrics,
            });
            this._metrics = null;
        }

        let location: string | null = null;
        if (this._beginIndex < this._locationLabels.length) {
            location = this._locationLabels[this._beginIndex];
        }
        const sectionIndex = this._beginIndex;
        this._beginIndex += 1;
        this._currentLocation = location;

        if (this._quiet) {
            return;
        }
        // Margin before every section but the first.
        if (sectionIndex > 0) {
            this._println("");
        }

        const count =
            begin.jobTotal < 0 ? "results: unknown total" : `~${begin.jobTotal} results`;
        if (location !== null) {
            this._println(
                "📍 " + this._color.cyan(this._color.bold(location)) + "   " + count,
            );
        } else {
            this._println(count);
        }
        this._spinner.setLabel("searching…");
    };

    onMetrics = (metrics: IMetrics): void => {
        // The emitted object is a shared reference mutated within a location, so retain a copy.
        this._metrics = { ...metrics };
        if (this._quiet) {
            return;
        }
        this._spinner.setLabel(formatMetrics(this._metrics));
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

        // Flush the final location. This bookkeeping runs even under --quiet.
        if (this._currentLocation !== null) {
            this._locationSummaries.push({
                label: this._currentLocation,
                metrics: this._metrics,
            });
        }

        if (this._quiet) {
            return;
        }

        if (this._locationSummaries.length <= 1) {
            const metrics = this._locationSummaries[0]?.metrics ?? this._metrics;
            if (metrics !== null && metrics !== undefined) {
                this._println("done: " + formatMetrics(metrics));
            } else {
                this._println("done");
            }
        } else {
            this._renderLocationSummary();
        }
        this._println("");
    };

    private _formatLocationMetrics(metrics: IMetrics): string {
        return (
            `processed=${metrics.processed} failed=${metrics.failed} ` +
            `missed=${metrics.missed} skipped=${metrics.skipped}`
        );
    }

    /**
     * Render one per-location statistics row per location plus a global `total` row. Per-location
     * counts are summed; account-wide throttled/pace are carried from the last location that
     * reported metrics rather than summed.
     */
    private _renderLocationSummary(): void {
        this._println("done:");

        const labels = this._locationSummaries.map(entry => entry.label ?? "");
        const padWidth = Math.max("total".length, ...labels.map(label => label.length));

        const total = zeroMetrics();
        let lastReported: IMetrics | null = null;

        for (const entry of this._locationSummaries) {
            const metrics = entry.metrics ?? zeroMetrics();
            this._println(
                this._rowPadded(
                    entry.label ?? "",
                    padWidth,
                    this._formatLocationMetrics(metrics),
                ),
            );
            if (entry.metrics !== null) {
                total.processed += entry.metrics.processed;
                total.failed += entry.metrics.failed;
                total.missed += entry.metrics.missed;
                total.skipped += entry.metrics.skipped;
                lastReported = entry.metrics;
            }
        }

        if (lastReported !== null) {
            total.throttled = lastReported.throttled;
            total.pace = lastReported.pace;
        }

        this._println(this._rowPadded("total", padWidth, formatMetrics(total)));
    }
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
