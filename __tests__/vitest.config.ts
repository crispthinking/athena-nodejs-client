import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: [
      'verbose',
      'github-actions'
    ],
    exclude: [...configDefaults.exclude, 'build/**/*'],
    coverage: {
      enabled: true,
      provider: 'v8',
      exclude: [...coverageConfigDefaults.exclude, 'build/**/*', 'src/athena/**/*']
    },
  },
})
