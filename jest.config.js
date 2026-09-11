module.exports = {
    roots: ['<rootDir>/src/test'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest'
    },
    testPathIgnorePatterns: [
        '/node_modules/',
        '/src/test/authenticated\\.test\\.ts$',
    ],
    verbose: true,
};