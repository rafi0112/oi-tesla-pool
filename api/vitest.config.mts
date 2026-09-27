import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    // Creates and migrates the test database before any suite runs.
    globalSetup: ['./tests/setup.ts'],
    env: { NODE_ENV: 'test' },
  },
})
