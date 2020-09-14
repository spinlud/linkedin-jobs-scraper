import { Page } from "puppeteer";
import { Scraper } from "../Scraper";
import { IQuery } from "../query";

export abstract class RunStrategy {
    protected scraper: Scraper;

    constructor(scraper: Scraper) {
        this.scraper = scraper;
    }

    abstract async run(
        page: Page,
        url: string,
        query: IQuery,
        location: string,
    ): Promise<void>;
}

export interface ILoadResult {
    success: boolean;
    error?: string | Error;
}
