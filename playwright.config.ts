/**
 * Browser tests at iPhone, iPad and desktop sizes, in Chromium and in WebKit
 * (Safari's engine, which Cecil's iPhone and iPad use).
 *
 * PW_BROWSERS picks the engines: "chromium,webkit" (the default, and CI) or
 * just "chromium" where WebKit isn't installed.
 */
import { defineConfig, devices, type Project } from "@playwright/test";

const PORT = 3100;
const engines = (process.env.PW_BROWSERS ?? "chromium,webkit").split(",").map((s) => s.trim());

const chromium: Project[] = [
  { name: "iphone-chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: "ipad-chromium", use: { browserName: "chromium", viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
];
const webkit: Project[] = [
  { name: "iphone-webkit", use: { ...devices["iPhone 16"] } },
  { name: "ipad-webkit", use: { ...devices["iPad (gen 11)"] } },
  { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
  },
  projects: [...(engines.includes("chromium") ? chromium : []), ...(engines.includes("webkit") ? webkit : [])],
  webServer: {
    // A fresh test database with the test data, and the built server (npm run build first).
    command: "npx tsx tests/e2e/serve.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
  },
});
