/**
 * v1's page, served unchanged, working against v2's server: sign-in, the
 * Follow-up button on its home page, a report made and issued in v1's own
 * screens, and a report round-tripped through v1's load and save.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- reports are read as plain JSON */
import { expect, test } from "@playwright/test";
import { PASSWORD, blockCdns, items, signIn, unique, v1Report, watchForErrors } from "./helpers.js";

test.beforeEach(async ({ context }) => {
  await blockCdns(context);
  await context.addInitScript({ content: 'localStorage.setItem("crb.testTools", "1");' });
});

test("sign in with the one password; the home page has a Follow-up button", async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto("/");
  await page.fill("#loginPassword", "wrong");
  await page.click('#loginForm button[type="submit"]');
  await expect(page.getByText("That password isn't right.")).toBeVisible();
  await page.fill("#loginPassword", PASSWORD);
  await page.click('#loginForm button[type="submit"]');
  await expect(page.locator('[data-act="openWalkUpload"]')).toBeVisible();
  const followUp = page.locator("#crbFollowUp");
  await expect(followUp).toHaveText("Follow-up");
  await followUp.click();
  await expect(page).toHaveURL(/\/follow-up/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Follow-up|Sign in/);
  expect(errors).toEqual([]);
});

test("a report made and issued in v1's screens becomes follow-up items", async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("desktop"), "one browser size is enough for v1's own screens");
  test.setTimeout(120_000);
  const errors = watchForErrors(page);
  await signIn(page.request);
  await page.goto("/");
  await page.click('[data-act="testNewAssessment"]');
  await page.waitForURL(/#a-[a-z0-9]+-review/, { timeout: 60_000 });
  const id = page.url().match(/#a-([a-z0-9]+)-/)![1]!;
  await expect(page.locator("#savestate")).toHaveText("Saved", { timeout: 30_000 });
  const report = await (await page.request.get(`/api/assessments/${id}`)).json();
  expect(report.photos.length).toBe(12);
  const photo = await page.request.get(`/files/${report.photos[0].asset}`);
  expect(photo.headers()["content-type"]).toBe("image/jpeg");

  await page.click('[data-act="issueReport"]');
  await expect(page.getByText(/issued and locked/)).toBeVisible();
  await signIn(request);
  await expect.poll(async () => (await items(request, report.propertyName)).length).toBeGreaterThan(0);
  const made = await items(request, report.propertyName);
  const actions = report.sections.flatMap((s: any) => s.items.flatMap((i: any) => i.findings)).filter((f: any) => !f.observationOnly);
  expect(made).toHaveLength(actions.length);
  expect(made.map((i: any) => i.number)).toEqual(made.map((_: unknown, n: number) => `A${n + 1}`));
  const issued = await (await page.request.get(`/api/assessments/${id}`)).json();
  expect(issued.status).toBe("issued");
  expect(issued.schema).toBe(6);
  expect(errors).toEqual([]);
});

test("a report round-trips through v1's load and save with nothing else changed", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("desktop"), "one browser size is enough for v1's own screens");
  await signIn(page.request);
  const original = v1Report(unique(testInfo, "Round Trip"));
  await page.request.put(`/api/assessments/${original.id}`, { data: original });

  await page.goto(`/#a-${original.id}-details`);
  const weather = page.locator('[data-bind="weather"]');
  await expect(weather).toHaveValue(original.weather);
  await weather.fill("Raining hard");
  await expect(page.locator("#savestate")).toHaveText("Saved", { timeout: 15_000 });
  await weather.fill(original.weather);
  await expect(page.locator("#savestate")).toHaveText("Saved", { timeout: 15_000 });
  await expect.poll(async () => (await (await page.request.get(`/api/assessments/${original.id}`)).json()).weather).toBe(original.weather);

  const saved = await (await page.request.get(`/api/assessments/${original.id}`)).json();
  // What v1's page changes on every save, by design: when, which tab, the day's version, and when text was edited.
  const bookkeeping = ["updatedAt", "_by", "versionDay", "textEditedAt"];
  const without = (doc: Record<string, unknown>) => Object.fromEntries(Object.entries(doc).filter(([k]) => !bookkeeping.includes(k)));
  expect(without(saved)).toEqual(without(original));
  expect(saved.schema).toBe(6);
  expect(saved.sections[0].items[0].findings[0].action).toMatchObject({ assignee: "Facility maintenance", due: "2027-03-01" });
});
