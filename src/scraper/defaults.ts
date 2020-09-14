import { LaunchOptions } from "puppeteer";
import { IQueryOptions } from "./query";

const browserDefaults: LaunchOptions = {
    headless: true,
    args: [
        "--enable-automation",
        "--start-maximized",
        "--window-size=1472,828",
        // "--single-process",
        "--lang=en-GB",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--proxy-server='direct://",
        "--proxy-bypass-list=*",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--allow-running-insecure-content",
        "--disable-web-security",
        "--disable-client-side-phishing-detection",
        "--disable-notifications",
        "--mute-audio",
    ],
    defaultViewport: null,
    pipe: true,
    slowMo: 100,
};

const queryOptionsDefault: IQueryOptions = {
    locations: [],
    limit: 25,
    optimize: true,
};

export { browserDefaults, queryOptionsDefault };
