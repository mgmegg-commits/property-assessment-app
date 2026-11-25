import { expect, test, type Page } from "@playwright/test";

/** Collects console errors and page crashes (a blocked script or style shows up here). */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const row = (page: Page, label: string) => page.locator(".status-row", { has: page.locator(".status-label", { hasText: label }) });

test("the start page says the app and database work, and shows the test data", async ({ page }) => {
  const errors = watchForErrors(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");

  await expect(page).toHaveTitle("Cecil's Report Builder");
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(row(page, "App")).toContainText("Working");
  await expect(row(page, "Database")).toContainText("Connected");
  await expect(row(page, "Test data")).toContainText("3 organizations loaded");
  await expect(page.getByText("Test copy")).toBeVisible();
  await expect(page.getByText("Version 2.0.0-dev")).toBeVisible();

  const orgs = page.getByRole("region", { name: "Test organizations" });
  await expect(orgs.getByRole("listitem")).toHaveCount(3);
  await expect(orgs).toContainText("Cecil Ingram Properties LLC");
  await expect(orgs).toContainText("Assessor firm");
  await expect(orgs).toContainText("Example Operator");
  await expect(orgs).toContainText("Facility operator");

  expect(errors).toEqual([]);
});

test("fits the screen with no sideways scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(row(page, "Test data")).toContainText("loaded");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("status rows are big enough to read and tap on a phone", async ({ page }) => {
  await page.goto("/");
  await expect(row(page, "Database")).toContainText("Connected");
  for (const label of ["App", "Database", "Test data"]) {
    const box = await row(page, label).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("a page address inside the app opens the app, not an error", async ({ page }) => {
  await page.goto("/reports/123/findings");
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
});
