/**
 * The job subcommand: scrape a single job by url or id.
 */
import { CliConfig } from "../cli-config";
import { runScrape } from "./scrape-runner";

/** Run the job subcommand, returning the process exit code. */
export const runJob = async (config: CliConfig): Promise<number> =>
    runScrape(config, {
        spinnerLabel: "loading job…",
        drive: scraper => scraper.scrapeJob(config.urlOrId, { applyLink: config.applyLink }),
    });
