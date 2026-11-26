/** Shared steps for the browser tests. The server is tests/e2e/serve.ts (one database for the whole run). */
import { readFileSync } from "node:fs";
import type { APIRequestContext, BrowserContext, Page, TestInfo } from "@playwright/test";

export const PASSWORD = "e2e-password";

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture reports are plain JSON */
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

/** v1 loads libraries and fonts from CDNs; answer them locally so tests don't need the internet. */
export async function blockCdns(context: BrowserContext): Promise<void> {
  // Answer with an empty file of the right type: WebKit logs an error for a stylesheet that isn't CSS.
  const types: Record<string, string> = { stylesheet: "text/css", script: "text/javascript", font: "font/woff2" };
  await context.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
    (route) => route.fulfill({ status: 200, body: "", contentType: types[route.request().resourceType()] ?? "text/plain" }));
}

/** A name no other test (or browser) in this run uses. */
export const unique = (testInfo: TestInfo, base: string): string => `${base} ${testInfo.project.name} ${testInfo.workerIndex}-${Date.now().toString(36)}`;

export async function signIn(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/login", { data: { password: PASSWORD } });
  if (!response.ok()) throw new Error(`Couldn't sign in: ${response.status()}`);
}

/** The schema 6 report v1 saves (tests/fixtures), as a fresh report. */
export function v1Report(propertyName: string): any {
  const id = `a${Math.random().toString(36).slice(2, 12)}`;
  return { ...fixture("v1/documents/assessment-schema-6.json"), id, propertyName, status: "draft", revision: 0, history: [] };
}

/** Saves a report as issued (as v1's page does when Cecil taps Issue) and returns its id. */
export async function issueReport(request: APIRequestContext, propertyName: string): Promise<string> {
  const report = v1Report(propertyName);
  const issued = { ...report, status: "issued", issuedAt: Date.now(), history: [{ rev: 0, at: Date.now() }] };
  const response = await request.put(`/api/assessments/${report.id}`, { data: issued });
  if (!response.ok()) throw new Error(`Couldn't issue: ${response.status()} ${await response.text()}`);
  return report.id;
}

export async function makeLink(request: APIRequestContext, property: string, personName: string): Promise<{ id: string; url: string }> {
  const response = await request.post("/api/follow-up/links", { data: { property, personName, role: "Maintenance lead", by: "Jordan Lee" } });
  if (!response.ok()) throw new Error(`Couldn't make a link: ${response.status()} ${await response.text()}`);
  return response.json();
}

/** The path part of a link (the copy's public address may differ in tests). */
export const linkPath = (url: string): string => new URL(url).pathname;

export async function items(request: APIRequestContext, property: string): Promise<any[]> {
  const page = await (await request.get("/api/follow-up")).json();
  return page.items.filter((i: any) => i.property === property);
}

/** Console errors and page crashes, ignoring the fixture's missing photo files and the 401 before signing in. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/404|401|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
