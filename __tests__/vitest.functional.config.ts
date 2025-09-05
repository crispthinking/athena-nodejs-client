import {
  configDefaults,
  coverageConfigDefaults,
  defineConfig,
} from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['verbose', 'github-actions'],
    exclude: [
      ...configDefaults.exclude,
      'build/**/*',
      'athena-protobufs/**/*',
      '__tests__/unit/**/*',
    ],
    include: ['__tests__/functional/**/*.test.ts'],
    testTimeout: 120000, // 2 minutes for functional tests
    hookTimeout: 30000, // 30 seconds for setup/teardown
    coverage: {
      enabled: false, // Disable coverage for functional tests
      provider: 'v8',
      exclude: [
        ...coverageConfigDefaults.exclude,
        'build/**/*',
        'samples/**/*',
        'src/athena/**/*',
        'athena-protobufs/**/*',
      ],
    },
  },
});
