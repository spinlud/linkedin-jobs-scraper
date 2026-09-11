/**
 * The jobs subcommand: search and scrape jobs.
 */
import { CliConfig } from "../cli-config";
import { buildQuery, describeLocations } from "../mapping";
import { runScrape } from "./scrape-runner";

/** Run the jobs subcommand, returning the process exit code. */
export const runJobs = async (config: CliConfig): Promise<number> =>
    runScrape(config, {
        spinnerLabel: "starting…",
        locationLabels: describeLocations(config),
        drive: scraper => scraper.run(buildQuery(config)),
    });
