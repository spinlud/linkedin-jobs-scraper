import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import { IEventListeners } from "./events";
import { LaunchOptions, ChromeArgOptions, BrowserOptions } from "puppeteer";
import { IQuery, IQueryOptions } from "./query";
import { logger } from "../logger/logger";

export type ScraperOptions = LaunchOptions & ChromeArgOptions & BrowserOptions;

export abstract class Scraper extends (EventEmitter as new () => TypedEmitter<IEventListeners>) {
    public options: ScraperOptions;

    /**
     * @constructor
     * @param {LaunchOptions} options
     */
    protected constructor(options: ScraperOptions) {
        super();
        this.options = options;
    }

    /**
     * Enable logger
     * @returns void
     * @static
     */
    public static enableLogger = () => logger.enable();

    /**
     * Disable logger
     * @returns void
     * @static
     */
    public static disableLogger = () => logger.disable();

    /**
     * Enable logger debug namespace
     * @returns void
     * @static
     */
    public static enableLoggerDebug = () => logger.enableDebug();

    /**
     * Enable logger info namespace
     * @returns void
     * @static
     */
    public static enableLoggerInfo = () => logger.enableInfo();

    /**
     * Enable logger warn namespace
     * @returns void
     * @static
     */
    public static enableLoggerWarn = () => logger.enableWarn();

    /**
     * Enable logger error namespace
     * @returns void
     * @static
     */
    public static enableLoggerError = () => logger.enableError();

    /**
     * Run scraper
     * @param {IQuery | IQuery[]} queries
     * @param {IQueryOptions} [options]
     * @return {Promise<void>}
     */
    abstract run (queries: IQuery | IQuery[], options?: IQueryOptions): Promise<void>;

    /**
     * Close scraper browser instance
     * @returns {Promise<void>}
     */
    abstract close(): Promise<void>;
}
