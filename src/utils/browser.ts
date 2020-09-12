const randomUserAgent = require("random-useragent");

const browsers = [
    {
        name: "Chrome",
        minVersion: 55
    },
    {
        name: "Firefox",
        minVersion: 50
    },
];

const folders = [
    "/Browsers - Linux",
    "/Browsers - Mac",
    // "Browsers - Windows",
];

const getRandomUserAgent = (): string => {
    return randomUserAgent.getRandom((ua: any) => {
        return folders.some(e => e === ua.folder) &&
            browsers.some(e => ua.browserName === e.name && parseInt(ua.browserMajor, 10) > e.minVersion);
    }) as string;
};

export {
    getRandomUserAgent,
};
