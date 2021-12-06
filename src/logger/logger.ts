import debug from "debug";

const namespace = "scraper";

const namespaces = {
    DEBUG: `${namespace}:debug`,
    INFO: `${namespace}:info`,
    WARN: `${namespace}:warn`,
    ERROR: `${namespace}:error`,
};

const logger = {
    debug: debug(namespaces.DEBUG),
    info: debug(namespaces.INFO),
    warn: debug(namespaces.WARN),
    error: debug(namespaces.ERROR),
    enable: () => {
        debug.enable(`${namespace}:*`);
    },
    disable: () => {
        debug.disable();
    },
    enableDebug: () => {
        debug.enable(`${namespace}:*`);
    },
    enableInfo: () => {
        debug.enable(`${namespaces.INFO},${namespaces.WARN},${namespaces.ERROR}`);
    },
    enableWarn: () => {
        debug.enable(`${namespaces.WARN},${namespaces.ERROR}`);
    },
    enableError: () => {
        debug.enable(namespaces.ERROR);
    },
};

// Bind INFO to console (default is stderr)
logger.info.log = console.log.bind(console);

if (!process.env.DEBUG) {
    logger.enableInfo();
    logger.enableWarn();
    logger.enableError();
}

export { logger };
