/**
 * Tests run from compiled dist-test/ (tsc -p tsconfig.spec.json → jest).
 * esbuild transpilers do not emit decorator metadata; Nest needs it.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist-test/test/**/*.test.js'],
  transform: {},
  // Without this row Jest 30 picks a reporter from the environment
  // (detectAgent() in @jest/core). Some environments enable the compact
  // `agent` reporter, which hides PASS lines, describe/it names and ✓.
  reporters: ['default'],
  testTimeout: 120000,
  maxWorkers: 1,
  verbose: true,
};
