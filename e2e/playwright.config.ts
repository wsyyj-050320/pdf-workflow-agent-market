import { defineConfig, devices } from '@playwright/test'

const API_URL = process.env.API_URL ?? 'http://localhost:8080'
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'api-only',
      testMatch: /.*\.api\.spec\.ts/,
      use: { baseURL: API_URL },
    },
    {
      name: 'chromium',
      testMatch: /.*\.ui\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.CI
    ? undefined
    : [
        {
          command: 'cd ../api && cargo run',
          url: `${API_URL}/health`,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: 'cd ../web && npm run dev',
          url: WEB_URL,
          reuseExistingServer: true,
          timeout: 30_000,
        },
      ],
})
