import { LaunchOptions } from "puppeteer";

export interface IRunOptions {
    paginationMax?: number; // Limit jobs pagination
    descriptionProcessor?: () => string; // Custom function to extract job description on browser side
    optimize?: boolean; // Block resources such as images, stylesheets etc to improve bandwidth usage
}

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
