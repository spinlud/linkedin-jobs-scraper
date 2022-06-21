module.exports = {
    roots: ['<rootDir>/src/test'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest'
    },
    testPathIgnorePatterns: [
        // ...
    ],
    verbose: true,
};