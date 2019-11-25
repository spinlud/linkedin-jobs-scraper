const debug = require("debug");
const namespace = "scraper";

const logger = {
    info: debug(`${namespace}:info`),
    error: debug(`${namespace}:error`),
    enable: () => {
        debug.enable(`${namespace}:*`);
    },
    disable: () => {
        debug.disable();
    },
    enableInfo: () => {
        debug.enable(`${namespace}:info`);
    },
    enableError: () => {
        debug.enable(`${namespace}:error`);
    },
}

logger.info.log = console.log.bind(console);

if (!process.env.DEBUG) {
    logger.enable();
}

module.exports = logger;
