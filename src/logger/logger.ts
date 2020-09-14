import debug from "debug";

const namespace = "scraper";

const namespaces = {
    INFO: `${namespace}:info`,
    WARN: `${namespace}:warn`,
    ERROR: `${namespace}:error`,
};

const logger = {
    info: debug(namespaces.INFO),
    warn: debug(namespaces.WARN),
    error: debug(namespaces.ERROR),
    enable: () => {
        debug.enable(`${namespace}:*`);
    },
    disable: () => {
        debug.disable();
    },
    enableInfo: () => {
        debug.enable(namespaces.INFO);
    },
    enableWarn: () => {
        debug.enable(namespaces.WARN);
    },
    enableError: () => {
        debug.enable(namespaces.ERROR);
    },
};

logger.info.log = console.log.bind(console);

if (!process.env.DEBUG) {
    logger.enable();
}

export { logger };
