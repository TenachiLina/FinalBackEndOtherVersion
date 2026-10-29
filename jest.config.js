// Two kinds of tests, measured together by `npm run test:cov`:
// - unit: src/**/*.spec.ts, next to the file they test
// - integration: test/**/*.e2e-spec.ts, the real app on a throw-away MongoDB
// See docs/TESTING.md.

const shared = {
  rootDir: __dirname,
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/test/tsconfig.json',
        // "hybrid module kind" notice: harmless with isolatedModules off
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  // @nestjs/jwt ships ES modules
  transformIgnorePatterns: ['node_modules/(?!@nestjs/jwt/)'],
  // The ZKTeco machine is never reached from tests
  moduleNameMapper: { '^node-zklib$': '<rootDir>/test/helpers/fake-zklib.ts' },
  setupFiles: ['<rootDir>/test/helpers/setup-env.ts'],
};

/** @type {import('jest').Config} */
module.exports = {
  // Booting the app from a cold ts-jest cache takes more than the default 5 s
  testTimeout: 30_000,
  // All integration files share one MongoDB; more workers than this starve it
  maxWorkers: '50%',
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/helpers/global-setup.ts',
      globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    // Starts a real server on a port; everything it sets up is in app.setup.ts
    '!src/main.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'text', 'html', 'json-summary'],
  // Raised after every phase (docs/TEST_PLAN.md) so coverage can't drop.
  coverageThreshold: {
    global: { lines: 99, statements: 98, branches: 92, functions: 99 },
  },
};
