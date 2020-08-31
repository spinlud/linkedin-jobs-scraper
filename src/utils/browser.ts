const randomUserAgent = require("random-useragent");

const browsers = [
    "Chrome",
    "Firefox",
    "Safari",
];

const folders = [
    "/Browsers - Linux",
    "/Browsers - Mac",
    "Browsers - Windows",
];

const getRandomUserAgent = (): string => {
    return randomUserAgent.getRandom((ua: any) => {
        return browsers.some(e => e === ua.browserName) && folders.some(e => e === ua.folder);
    }) as string;
};

export {
    getRandomUserAgent,
};
