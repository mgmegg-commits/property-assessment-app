/**
 * Website server tests:  node --test tests/server.test.mjs
 * Drafting runs with a fake Claude client, so no key or network is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { newAssessment } from "../src/js/model/assessment.js";

const SEGMENTS = [
  { id: "s1", start: 0.2, end: 2.2, text: "Okay, we're starting at the main entrance." },
  { id: "s2", start: 2.5, end: 7, text: "Roof drain on the northeast corner is clogged." },
];
const ANSWER = {
  issues: [{ sectionId: "env", subsectionId: "env.roof", newSubsectionName: "", title: "Clear roof drain", description: "Clogged drain.", location: "", recommendation: "Clear it.", priority: "Medium", sourceSegmentIds: ["s2", "s99"] }],
  subsections: [
    { sectionId: "env", subsectionId: "env.roof", newSubsectionName: "", rating: "F", note: "Fair, with a clogged drain.", sourceSegmentIds: ["s2"] },
    { sectionId: "env", subsectionId: "env.roof", newSubsectionName: "", rating: "Excellent", note: "", sourceSegmentIds: [] },
  ],
  sections: [{ sectionId: "env", summary: "The envelope is in fair condition." }, { sectionId: "", summary: "No section." }],
};

/** Answers drafting requests with ANSWER, and spelling checks with one fix. */
function fakeClaude(captured) {
  const stream = (params) => {
    captured.push(params);
    const spelling = /You proofread/.test(params.messages[0].content);
    const parsed = spelling ? { fixes: [{ k: 0, find: "form", replace: "from", why: "wrong word" }, { k: 5, find: "x", replace: "y", why: "no such text" }] } : ANSWER;
    return { finalMessage: async () => ({ stop_reason: "end_turn", model: params.model, parsed_output: parsed, usage: {} }) };
  };
  return { beta: { messages: { stream } } };
}

async function startApp(t, { captured = [], claudeConfigured = true, claude } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "crb-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const config = { dataDir, password: "pw", sessionSecret: "secret", draftModel: "claude-opus-5-5", trainingExamples: 3, claudeConfigured };
  const app = await createApp(config, { claude: claude === undefined ? fakeClaude(captured) : claude, log: { error: () => {} } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.server.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = "";
  const call = async (method, url, body, headers = {}) => {
    const isJson = body !== undefined && !(body instanceof Buffer);
    const res = await fetch(base + url, { method, headers: { cookie, ...(isJson ? { "content-type": "application/json" } : {}), ...headers }, body: isJson ? JSON.stringify(body) : body });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  return { app, call };
}

async function waitForJob(call, id) {
  for (let i = 0; i < 100; i++) {
    const { json } = await call("GET", `/api/jobs/${id}`);
    if (json.status !== "running") return json;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("job never finished");
}

test("everything but sign-in needs a session", async (t) => {
  const { call } = await startApp(t);
  assert.equal((await call("GET", "/api/session")).json.authenticated, false);
  for (const [method, url] of [["GET", "/api/assessments"], ["GET", "/api/docs/transcripts/x"], ["POST", "/api/assessments/x/draft"], ["GET", "/files/x"]]) {
    assert.equal((await call(method, url)).status, 401, `${method} ${url}`);
  }
  assert.equal((await call("POST", "/api/login", { password: "nope" })).status, 401);
  assert.equal((await call("POST", "/api/login", { password: "pw" })).status, 200);
  assert.equal((await call("GET", "/api/session")).json.authenticated, true);
  assert.equal((await call("POST", "/api/logout")).status, 200);
  assert.equal((await call("GET", "/api/assessments")).status, 401, "signed out again");
});

test("reports, photos, transcripts and training examples are stored", async (t) => {
  const { call } = await startApp(t);
  await call("POST", "/api/login", { password: "pw" });
  const a = newAssessment({ templateKey: "realestate", propertyName: "Riverside" });
  assert.equal((await call("PUT", `/api/assessments/${a.id}`, a)).status, 200);
  assert.equal((await call("GET", "/api/assessments")).json.assessments.length, 1);
  const photo = await call("POST", "/api/files", Buffer.from([0xff, 0xd8, 0xff]), { "content-type": "image/jpeg" });
  assert.equal(photo.status, 201);
  assert.equal((await call("GET", `/files/${photo.json.id}`)).text.length > 0, true);
  assert.equal((await call("POST", "/api/files", Buffer.from("<svg/>"), { "content-type": "image/svg+xml" })).status, 415);
  await call("PUT", `/api/docs/transcripts/${a.id}`, { assessmentId: a.id, segments: SEGMENTS });
  assert.equal((await call("GET", `/api/docs/transcripts/${a.id}`)).json.segments.length, 2);
  assert.equal((await call("GET", "/api/docs/secrets/x")).status, 404, "only known collections");
  assert.equal((await call("GET", "/api/docs/versionIndex/nope")).status, 404);
  const optional = await call("GET", "/api/docs/versionIndex/nope?optional=1");
  assert.deepEqual([optional.status, optional.json], [200, null], "the app can check without an error");
  await call("PUT", `/api/docs/versions/${a.id}-v1`, { id: `${a.id}-v1`, doc: a });
  assert.equal((await call("GET", `/api/docs/versions/${a.id}-v1`)).json.doc.id, a.id, "versions are stored on the server");
  assert.equal((await call("GET", "/api/docs/transcripts/..%2F..%2Fsettings")).status, 400, "ids can't leave the data folder");
});

test("drafting builds the prompt on the server and returns checked findings", async (t) => {
  const captured = [];
  const { call } = await startApp(t, { captured });
  await call("POST", "/api/login", { password: "pw" });
  const a = newAssessment({ templateKey: "realestate", propertyName: "Riverside" });
  await call("PUT", `/api/assessments/${a.id}`, a);
  await call("PUT", `/api/docs/transcripts/${a.id}`, { assessmentId: a.id, segments: SEGMENTS });
  await call("PUT", "/api/settings", { company: "X", phrases: [{ id: "p1", title: "Roof drains", text: "Clear the roof drains and keep them clear." }] });
  await call("PUT", "/api/docs/training/older", { assessmentId: "older", propertyName: "Old job", finalizedAt: 1, transcript: SEGMENTS, issues: [{ title: "Earlier finding" }] });

  const job = await waitForJob(call, (await call("POST", `/api/assessments/${a.id}/draft`)).json.id);
  assert.equal(job.status, "done", job.error);
  assert.deepEqual(job.draft.issues[0].sourceSegmentIds, ["s2"], "unknown remark ids dropped");
  assert.deepEqual(job.draft.subsections.map((x) => [x.subsectionId, x.rating]), [["env.roof", "F"]], "unknown ratings dropped");
  assert.deepEqual(job.draft.sections.map((x) => x.sectionId), ["env"]);
  assert.equal(job.examplesUsed, 1);
  const request = captured[0];
  assert.equal(request.model, "claude-opus-5-5");
  assert.equal(request.fallbacks, "default");
  assert.equal(request.output_config.effort, "high");
  assert.match(request.messages[0].content, /\[s2 0:03-0:07\] Roof drain/);
  assert.match(request.messages[0].content, /\[env\.roof\] Roof/, "the report's own list, with ids");
  const schema = request.output_config.format.schema;
  assert.deepEqual(Object.keys(schema.properties).sort(), ["issues", "sections", "subsections"], "structured output asks for the whole draft");
  assert.match(request.messages[0].content, /<example number="1" property="Old job">/);
  assert.match(request.messages[0].content, /- Roof drains: Clear the roof drains and keep them clear\./, "his saved phrase library goes into the prompt");
});

test("drafting without a saved transcript, or without a key, explains itself", async (t) => {
  const { call } = await startApp(t, { claudeConfigured: false, claude: null });
  await call("POST", "/api/login", { password: "pw" });
  const a = newAssessment({ templateKey: "realestate" });
  await call("PUT", `/api/assessments/${a.id}`, a);
  let job = await waitForJob(call, (await call("POST", `/api/assessments/${a.id}/draft`)).json.id);
  assert.match(job.error, /Save the report and its walk-through/);
  await call("PUT", `/api/docs/transcripts/${a.id}`, { assessmentId: a.id, segments: SEGMENTS });
  job = await waitForJob(call, (await call("POST", `/api/assessments/${a.id}/draft`)).json.id);
  assert.match(job.error, /ANTHROPIC_API_KEY/);
});

test("the spelling check runs on the server with the shared prompt", async (t) => {
  const captured = [];
  const { call } = await startApp(t, { captured });
  assert.equal((await call("POST", "/api/spelling", { texts: ["x"] })).status, 401);
  await call("POST", "/api/login", { password: "pw" });
  const result = await call("POST", "/api/spelling", { texts: ["Water came in form the roof."] });
  assert.equal(result.status, 200);
  assert.equal(result.json.fixes[0].replace, "from");
  assert.match(captured[0].messages[0].content, /"text":"Water came in form the roof\."/);
  assert.equal(captured[0].output_config.effort, "medium");
  assert.equal((await call("POST", "/api/spelling", { texts: "not a list" })).status, 400);
});
