import {
  configDefaults,
  coverageConfigDefaults,
  defineConfig,
} from 'vitest/config';

export default defineConfig({
  test: {
    reporters: ['verbose', 'github-actions'],
    exclude: [...configDefaults.exclude, 'build/**/*', 'athena-protobufs/**/*'],
    coverage: {
      enabled: true,
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
