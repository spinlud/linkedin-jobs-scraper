import { LaunchOptions } from "puppeteer";
import { IQueryOptions } from "./query";

const browserDefaults: LaunchOptions = {
    headless: true,
    args: [
        // `--window-size=${1920},${1080}`,
        // "--single-process",
        "--lang=en-GB",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--enable-automation",
        "--lang=en-GB",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--proxy-bypass-list=*",
        "--disable-dev-shm-usage",
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
    slowMo: 10,
};

const queryOptionsDefault: IQueryOptions = {
    locations: ["Worldwide"],
    limit: 25,
    optimize: true,
};

export { browserDefaults, queryOptionsDefault };
