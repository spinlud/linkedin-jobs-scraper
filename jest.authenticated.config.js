const base = require('./jest.config');

module.exports = {
    ...base,
    testPathIgnorePatterns: ['/node_modules/'],
    testMatch: ['**/src/test/authenticated.test.ts'],
    // Treat TypeScript as ESM so the pure-ESM puppeteer module chain loads natively under node.
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            useESM: true,
            tsconfig: 'tsconfig.jest-esm.json',
        }],
    },
};
