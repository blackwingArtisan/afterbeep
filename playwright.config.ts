import { defineConfig, devices } from '@playwright/test';

const PORT = 3112;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /caller\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run build && rm -rf test-results/e2e-data && node dist/server/main.js`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      AFTERBEEP_DATA_DIR: 'test-results/e2e-data',
      AFTERBEEP_PUBLIC_URL: `http://localhost:${PORT}`,
    },
  },
});
