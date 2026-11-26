/**
 * The Follow-up page: items by property, counts and filters, overdue flags,
 * editing on the client's behalf (who and when), personal links, the export.
 */
import { expect, test } from "@playwright/test";
import { issueReport, items, signIn, unique, watchForErrors } from "./helpers.js";

test("without signing in, it says to sign in", async ({ page }) => {
  await page.goto("/follow-up");
  await expect(page.getByRole("heading", { name: "Sign in first" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to sign-in" })).toHaveAttribute("href", "/");
});

test("lists a property's items, filters them, and flags overdue ones", async ({ page }, testInfo) => {
  const property = unique(testInfo, "Pine Grove");
  await signIn(page.request);
  await issueReport(page.request, property);
  const [first] = await items(page.request, property);
  await page.request.patch(`/api/follow-up/items/${first.id}`, { data: { by: "Jordan Lee", dueDate: "2020-01-15" } });

  const errors = watchForErrors(page);
  await page.goto(`/follow-up?property=${encodeURIComponent(property)}`);
  await expect(page.getByRole("heading", { name: "Follow-up", level: 1 })).toBeVisible();
  await expect(page.getByText(`${property} · report issued`)).toBeVisible();
  const rows = page.locator(".fu-row-btn");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("A1");
  await expect(rows.first()).toContainText("TPO repairs not per specs");
  await expect(rows.first()).toContainText("Overdue");
  await expect(page.locator(".fu-count-overdue b")).toHaveText("1");

  await page.getByRole("button", { name: "Overdue · 1" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "Done · 0" }).click();
  await expect(page.getByText("No items in this view.")).toBeVisible();
  await page.getByRole("button", { name: "All · 3" }).click();
  await expect(rows).toHaveCount(3);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("an item is assigned and dated on the client's behalf, and the change records who", async ({ page }, testInfo) => {
  const property = unique(testInfo, "Oak Hollow");
  await signIn(page.request);
  await issueReport(page.request, property);
  await page.goto(`/follow-up?property=${encodeURIComponent(property)}`);

  await page.fill("#fuName", "Jordan Lee");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes are recorded as")).toContainText("Jordan Lee");

  await page.locator(".fu-row-btn", { hasText: "Repair pool deck" }).click();
  const editor = page.locator(".fu-editor");
  await editor.getByLabel("Facility").fill("Clubhouse");
  await editor.getByLabel("Assigned to").fill("Alex Rivera");
  await editor.getByLabel("Due date").fill("2027-01-15");
  await editor.getByRole("button", { name: "In progress" }).click();
  await editor.getByLabel("Note (optional)").fill("Contractor booked.");
  await editor.getByRole("button", { name: "Save" }).click();

  const row = page.locator(".fu-row-btn", { hasText: "Repair pool deck" });
  await expect(row).toContainText("Alex Rivera");
  await expect(row).toContainText("Jan 15, 2027");
  await expect(row).toContainText("In progress");
  await expect(row).toContainText("Jordan Lee");
  const saved = (await items(page.request, property)).find((i) => i.title === "Repair pool deck");
  expect(saved).toMatchObject({ facility: "Clubhouse", assignee: "Alex Rivera", dueDate: "2027-01-15", status: "in_progress" });
  expect(saved.lastUpdate).toMatchObject({ by: "Jordan Lee", via: "office" });
});

test("makes a personal link, turns it off and on; exports to Excel", async ({ page }, testInfo) => {
  const property = unique(testInfo, "Elm Court");
  await signIn(page.request);
  await issueReport(page.request, property);
  await page.addInitScript({ content: 'localStorage.setItem("crb.followUpName", "Jordan Lee");' });
  await page.goto(`/follow-up?property=${encodeURIComponent(property)}`);
  // The clipboard isn't always open to tests; fall back to the prompt the page shows.
  page.on("dialog", (dialog) => void dialog.dismiss());

  await page.getByRole("button", { name: "+ New link" }).click();
  await page.getByLabel("Name").fill("Alex Rivera");
  await page.getByLabel("Role (optional)").fill("Maintenance lead");
  await page.getByRole("button", { name: "Make link and copy it" }).click();
  const linkRow = page.locator(".fu-linkrow", { hasText: "Alex Rivera" });
  await expect(linkRow).toContainText("Maintenance lead");
  await expect(linkRow.locator(".pill")).toHaveText("Active");

  await linkRow.getByRole("button", { name: "Turn off" }).click();
  await expect(linkRow.locator(".pill")).toHaveText("Turned off");
  await linkRow.getByRole("button", { name: "Turn on" }).click();
  await expect(linkRow.locator(".pill")).toHaveText("Active");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export to Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/follow-up \d{4}-\d{2}-\d{2}\.xlsx$/);
});
