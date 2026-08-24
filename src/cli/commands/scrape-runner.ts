/**
 * Shared driver for the jobs and job subcommands.
 *
 * Both build the scraper, register handlers, announce, drive the run, and reduce the outcome onto
 * an exit code the same way; only the spinner label, the location labels, and the run call itself
 * differ, so those are passed in.
 */
import { LinkedinScraper } from "../../scraper/LinkedinScraper";
import { InvalidCookieException } from "../../scraper/exceptions";
import { ensureSession } from "../../scraper/auth";
import { CliConfig } from "../cli-config";
import { buildScraperOptions } from "../mapping";
import { createSpinner } from "../spinner";
import { createFeedback, registerEvents } from "../feedback";
import { OutputConfigError, Writer, createWriter } from "../output";
import { computeExitCode } from "../exit-codes";

const LOGIN_TIMEOUT_MS = 600_000;

export interface ScrapePlan {
    spinnerLabel: string;
    locationLabels?: string[];
    drive: (scraper: LinkedinScraper) => Promise<void>;
}

/** Build the scraper, run the plan, and return the process exit code. */
export const runScrape = async (config: CliConfig, plan: ScrapePlan): Promise<number> => {
    const spinner = createSpinner(config);

    let writer: Writer;
    try {
        writer = createWriter(config, spinner);
    } catch (err) {
        if (err instanceof OutputConfigError) {
            process.stderr.write(`error: ${err.message}\n`);
            return 2;
        }
        throw err;
    }

    const feedback = createFeedback(config, spinner);

    let raisedInvalidCookie = false;
    let raisedOther = false;
    let otherMessage: string | null = null;
    let scraper: LinkedinScraper | null = null;

    try {
        // Interactive login populates the profile before the scrape reuses it.
        if (config.interactiveLogin && config.chromeUserDataDir) {
            await ensureSession(config.chromeUserDataDir, { timeoutMs: LOGIN_TIMEOUT_MS });
        }

        scraper = new LinkedinScraper(buildScraperOptions(config));
        registerEvents(scraper, writer, feedback);

        if (plan.locationLabels) {
            feedback.setLocationLabels(plan.locationLabels);
        }
        feedback.announce(config);
        writer.begin();
        spinner.start(plan.spinnerLabel);

        await plan.drive(scraper);
    } catch (err) {
        if (err instanceof InvalidCookieException) {
            raisedInvalidCookie = true;
        } else {
            raisedOther = true;
            otherMessage = err instanceof Error ? err.message : String(err);
        }
    } finally {
        writer.end();
        spinner.stop();
        if (scraper) {
            // Release Chrome so the process can exit; the library leaves the browser open after a
            // successful run.
            try {
                await scraper.close();
            } catch (err) {
                // Best effort: a close failure must not mask the run's own outcome.
            }
        }
    }

    if (
        raisedOther &&
        !(raisedInvalidCookie || feedback.invalidSession || feedback.notFound)
    ) {
        process.stderr.write(`error: ${otherMessage}\n`);
    }

    return computeExitCode(
        raisedInvalidCookie,
        feedback.invalidSession,
        feedback.notFound,
        raisedOther,
    );
};
