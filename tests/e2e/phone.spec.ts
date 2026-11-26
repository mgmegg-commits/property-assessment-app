/**
 * The phone page a personal update link opens, at iPhone size: only that
 * property's open items, one tap for In progress or Done, a note and a photo,
 * and nothing once the link is turned off.
 */
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { issueReport, items, linkPath, makeLink, signIn, unique, watchForErrors } from "./helpers.js";

const PHOTO = fileURLToPath(new URL("../fixtures/v1/IMG_100.jpg", import.meta.url));

// eslint-disable-next-line no-empty-pattern -- Playwright passes fixtures first
test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("iphone"), "the phone page is checked at iPhone size");
});

/** Two properties, each with an issued report, and a link for one person at the first. */
async function setUp(request: APIRequestContext, property: string) {
  await signIn(request);
  await issueReport(request, property);
  await issueReport(request, `${property} (other)`);
  const link = await makeLink(request, property, "Alex Rivera");
  return { link, path: linkPath(link.url) };
}

test("shows only this property's open items, and says hi", async ({ page, request }, testInfo) => {
  const property = unique(testInfo, "Pine Grove");
  const { path } = await setUp(request, property);
  const errors = watchForErrors(page);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Hi Alex" })).toBeVisible();
  await expect(page.getByText(property, { exact: true })).toBeVisible();
  await expect(page.getByText("3 items still need an update")).toBeVisible();
  const cards = page.locator(".ph-item");
  await expect(cards).toHaveCount(3);
  for (const title of ["TPO repairs not per specs", "Repair pool deck", "Replace stained ceiling tiles"]) await expect(cards.filter({ hasText: title })).toHaveCount(1);
  await expect(page.getByText(`${property} (other)`)).toHaveCount(0);
  await expect(page.getByText("Cecil Ingram Properties")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const box of await Promise.all((await cards.all()).map((c) => c.boundingBox()))) expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});

test("mark an item Done with a note and a photo, in a few taps", async ({ page, request }, testInfo) => {
  const property = unique(testInfo, "Oak Hollow");
  const { path } = await setUp(request, property);
  const errors = watchForErrors(page);
  await page.goto(path);
  await page.locator(".ph-item", { hasText: "Repair pool deck" }).click();
  await expect(page.getByRole("heading", { name: "Repair pool deck" })).toBeVisible();
  await expect(page.getByText("Repair the cracks.")).toBeVisible();
  const save = page.getByRole("button", { name: "Save update" });
  await expect(save).toBeDisabled();

  const done = page.getByRole("button", { name: "Done", exact: true });
  await done.click();
  await expect(done).toHaveAttribute("aria-pressed", "true");
  for (const button of [done, page.getByRole("button", { name: "In progress" }), save]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.fill("#note", "Cracks sealed by the pool contractor.");
  await page.setInputFiles('input[type="file"]', PHOTO);
  await expect(page.getByText("1 photo attached · tap to change")).toBeVisible();
  await save.click();

  await expect(page.getByText("Thanks, your update was saved.")).toBeVisible();
  await expect(page.locator(".ph-item")).toHaveCount(2);
  await expect(page.locator(".ph-item", { hasText: "Repair pool deck" })).toHaveCount(0);

  const deck = (await items(request, property)).find((i) => i.title === "Repair pool deck");
  expect(deck.status).toBe("done");
  expect(deck.lastUpdate).toMatchObject({ by: "Alex Rivera", via: "link", text: "Marked Done: Cracks sealed by the pool contractor. (1 photo)" });
  expect(Date.parse(deck.lastUpdate.at)).toBeGreaterThan(Date.now() - 120_000);
  expect(deck.lastUpdate.photoId).toBeTruthy();
  expect(errors).toEqual([]);
});

test("In progress with only a note keeps the item on the list, with its update shown", async ({ page, request }, testInfo) => {
  const property = unique(testInfo, "Elm Court");
  const { path } = await setUp(request, property);
  await page.goto(path);
  await page.locator(".ph-item", { hasText: "TPO repairs not per specs" }).click();
  await page.getByRole("button", { name: "In progress" }).click();
  await page.fill("#note", "Roofer booked for Dec 8.");
  await page.getByRole("button", { name: "Save update" }).click();
  await expect(page.getByText("Thanks, your update was saved.")).toBeVisible();
  const card = page.locator(".ph-item", { hasText: "TPO repairs not per specs" });
  await expect(card.locator(".pill")).toHaveText("In progress");
  await card.click();
  await expect(page.locator(".ph-update-entry").first()).toContainText("Alex Rivera");
  await expect(page.locator(".ph-update-entry").first()).toContainText("Marked In progress: Roofer booked for Dec 8.");
  await page.getByRole("button", { name: "All items" }).click();
  await expect(page.getByRole("heading", { name: "Hi Alex" })).toBeVisible();
});

test("a turned-off link shows only that it's turned off, and works again when turned on", async ({ page, request }, testInfo) => {
  const property = unique(testInfo, "Birch Lane");
  const { link, path } = await setUp(request, property);
  await request.patch(`/api/follow-up/links/${link.id}`, { data: { active: false } });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "This link has been turned off" })).toBeVisible();
  await expect(page.getByText("Ask Cecil Ingram Properties for a new link if you still need to send updates.")).toBeVisible();
  await expect(page.getByText(property)).toHaveCount(0);
  await expect(page.locator(".ph-item")).toHaveCount(0);

  await request.patch(`/api/follow-up/links/${link.id}`, { data: { active: true } });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hi Alex" })).toBeVisible();
});

test("a link that doesn't exist says so", async ({ page }) => {
  await page.goto(`/u/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
});
