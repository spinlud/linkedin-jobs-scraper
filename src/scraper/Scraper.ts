import { EventEmitter } from "events";
import TypedEmitter from "typed-emitter";
import { IEventListeners } from "./events";
import {LaunchOptions, Page} from "puppeteer";
import {IQuery, IQueryOptions} from "./query";
import { logger } from "../logger/logger";

export abstract class Scraper extends (EventEmitter as new () => TypedEmitter<IEventListeners>) {
    public options: LaunchOptions;

    constructor(options: LaunchOptions) {
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
    abstract async run (queries: IQuery | IQuery[], options?: IQueryOptions): Promise<void>;

    /**
     * Close scraper browser instance
     * @returns {Promise<void>}
     */
    abstract async close(): Promise<void>;
}
