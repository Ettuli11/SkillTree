import { defineConfig, devices } from "@playwright/test";

// The app is started separately (start.bat -> http://localhost:5201).
// Uses the locally installed Google Chrome, no browser download needed.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // desktop and mobile reorder the same category: never run them concurrently
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5201",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
