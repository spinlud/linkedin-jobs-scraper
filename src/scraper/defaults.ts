import { LaunchOptions } from "puppeteer";
import { IQueryOptions } from "./query";

const browserDefaults: LaunchOptions = {
    headless: true,
    args: [
        // `--window-size=${1920},${1080}`,
        "--lang=en-GB",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
    ],
    defaultViewport: null,
    pipe: true,
    slowMo: 10,
};

const queryOptionsDefault: IQueryOptions = {
    locations: ["Worldwide"],
    limit: 25,
    optmize: true,
};

export { browserDefaults, queryOptionsDefault };
