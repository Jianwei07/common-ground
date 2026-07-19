import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  ...(process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? {}
    : {
        webServer: {
          command: "pnpm start",
          url: "http://127.0.0.1:3000/workspace",
          reuseExistingServer: !process.env.CI,
        },
      }),
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
