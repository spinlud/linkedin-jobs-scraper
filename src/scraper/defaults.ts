import { LaunchOptions } from "puppeteer";
import { IRunOptions } from "./options";

const runOptionsDefaults: IRunOptions = {
    paginationMax: 1,
    optimize: false,
};

const browserDefaults: LaunchOptions = {
    headless: true,
    args: [
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

export { runOptionsDefaults, browserDefaults };
