import { defineConfig, devices } from "@playwright/test";

const testPort = 3100;
const testOrigin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: testOrigin,
    trace: "retain-on-failure",
  },
  ...(process.env.PLAYWRIGHT_EXTERNAL_SERVER
    ? {}
    : {
        webServer: {
          command: `pnpm exec next start -p ${testPort}`,
          url: `${testOrigin}/workspace`,
          reuseExistingServer: !process.env.CI,
        },
      }),
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      ...(process.env.PLAYWRIGHT_SYSTEM_CHROME ? { channel: "chrome" as const } : {}),
    },
  }],
});
