/**
 * v1's JSON API (v1 server/app.js at 03104a2), route for route, so v1's page
 * works unchanged. Only the storage differs: PostgreSQL and the data volume
 * instead of v1's files. v1's own tests/server.test.mjs runs against it
 * (tests/v1-server).
 *
 *   GET  /api/session                public: { app, authenticated, drafting }
 *   POST /api/login, /api/logout     public
 *   GET  /api/assessments/version    a number that changes when any report does
 *   GET  /api/assessments            { version, assessments }
 *   GET|PUT|DELETE /api/assessments/:id   (DELETE hides the report)
 *   GET|PUT /api/settings
 *   GET  /api/docs/:collection, GET|PUT /api/docs/:collection/:id
 *   POST /api/files, GET /files/:id, DELETE /api/files/:id (hides the file)
 *   POST /api/assessments/:id/draft, GET /api/jobs/:id
 *   POST /api/spelling
 */
import type { FastifyInstance } from "fastify";
import type { Auth } from "./auth.js";
import { DraftFailed } from "./claude.js";
import type { Config } from "./config.js";
import type { DraftingService } from "./drafting.js";
import { DOC_COLLECTIONS, assertId, type Json, type Storage } from "./storage.js";

export const MB = 1_048_576;
export const LIMITS = { json: 4 * MB, file: 25 * MB };
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

/** Called inside the transaction that saves a report, with the report as it was before (or null). */
export type OnReportSaved = (doc: Json, previous: Json | null, db: import("pg").PoolClient) => Promise<void>;

export interface V1ApiOptions {
  storage: Storage;
  auth: Auth;
  drafting: DraftingService;
  config: Pick<Config, "claudeConfigured">;
  onReportSaved?: OnReportSaved;
}

const docCollection = (name: string): string => {
  if (!DOC_COLLECTIONS.has(name)) throw new HttpError(404, "Not found.");
  return name;
};

export function registerV1Api(app: FastifyInstance, { storage, auth, drafting, config, onReportSaved }: V1ApiOptions): void {
  const open = { config: { public: true } };

  /* ---------- Sign-in ---------- */
  app.get("/api/session", open, async (request) => ({
    app: "cecils-report-builder",
    authenticated: auth.isAuthenticated(request),
    drafting: config.claudeConfigured,
  }));
  app.post("/api/login", open, async (request, reply) => {
    auth.login(request, reply, (request.body as { password?: unknown } | null)?.password);
    return { ok: true };
  });
  app.post("/api/logout", open, async (_request, reply) => {
    auth.logout(reply);
    return { ok: true };
  });

  /* ---------- Reports and settings ---------- */
  app.get("/api/assessments/version", async () => ({ version: await storage.version() }));
  app.get("/api/assessments", async () => ({ version: await storage.version(), assessments: await storage.listAssessments() }));
  app.get<{ Params: { id: string } }>("/api/assessments/:id", async (request) => {
    const doc = await storage.getAssessment(request.params.id);
    if (!doc) throw new HttpError(404, "Report not found.");
    return doc;
  });
  app.put<{ Params: { id: string } }>("/api/assessments/:id", { bodyLimit: LIMITS.json }, async (request) => {
    const doc = request.body as Json;
    if (!doc || typeof doc !== "object" || doc.id !== assertId(request.params.id) || doc.kind !== "assessment") {
      throw new HttpError(400, "The document doesn't match this report.");
    }
    const client = await storage.pool.connect();
    try {
      await client.query("BEGIN");
      // Saves of one report are one at a time, so issuing it is seen exactly once.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`report:${doc.id}`]);
      const previous = await storage.getAssessment(doc.id, client);
      await storage.saveAssessment(doc, client);
      if (onReportSaved) await onReportSaved(doc, previous, client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { ok: true, version: await storage.version() };
  });
  app.delete<{ Params: { id: string } }>("/api/assessments/:id", async (request) => {
    await storage.deleteAssessment(request.params.id);
    return { ok: true };
  });
  app.get("/api/settings", async () => (await storage.getSettings()) || {});
  app.put("/api/settings", { bodyLimit: LIMITS.json }, async (request) => {
    await storage.saveSettings(request.body);
    return { ok: true };
  });

  /* ---------- Transcripts, training examples and versions ---------- */
  app.get<{ Params: { collection: string } }>("/api/docs/:collection", async (request) => storage.listDocs(docCollection(request.params.collection)));
  app.get<{ Params: { collection: string; id: string }; Querystring: { optional?: string } }>("/api/docs/:collection/:id", async (request, reply) => {
    const doc = await storage.getDoc(docCollection(request.params.collection), request.params.id);
    // ?optional=1: the page is only checking (e.g. a report with no versions yet), so a missing doc is null, not an error.
    if (!doc && request.query.optional === "1") return reply.send(null);
    if (!doc) throw new HttpError(404, "Not found.");
    return doc;
  });
  app.put<{ Params: { collection: string; id: string } }>("/api/docs/:collection/:id", { bodyLimit: LIMITS.json }, async (request) => {
    await storage.putDoc(docCollection(request.params.collection), request.params.id, request.body);
    return { ok: true };
  });

  /* ---------- Photos and logos ---------- */
  app.post("/api/files", { bodyLimit: LIMITS.file }, async (request, reply) => {
    const type = String(request.headers["content-type"] || "").split(";")[0]!.trim();
    if (!IMAGE_TYPES.includes(type) || !Buffer.isBuffer(request.body)) throw new HttpError(415, "Only JPEG, PNG and WebP images can be stored.");
    reply.code(201);
    return { id: await storage.putFile(request.body, type) };
  });
  app.get<{ Params: { id: string } }>("/files/:id", async (request, reply) => {
    const meta = await storage.getFileMeta(request.params.id);
    if (!meta) throw new HttpError(404, "File not found.");
    // A hidden ("deleted") file is still served: an earlier version of a report may show it.
    return reply
      .header("content-type", meta.contentType)
      .header("content-length", meta.bytes)
      .header("cache-control", "private, max-age=31536000, immutable")
      .send(storage.fileStream(meta.id));
  });
  app.delete<{ Params: { id: string } }>("/api/files/:id", async (request) => {
    await storage.hideFile(request.params.id);
    return { ok: true };
  });

  /* ---------- Drafting ---------- */
  app.post<{ Params: { id: string } }>("/api/assessments/:id/draft", async (request, reply) => {
    reply.code(202);
    return drafting.start(assertId(request.params.id));
  });
  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request) => {
    const job = await drafting.getJob(assertId(request.params.id));
    if (!job) throw new HttpError(404, "Job not found.");
    return job;
  });

  /* ---------- Spelling check ---------- */
  app.post("/api/spelling", { bodyLimit: LIMITS.json }, async (request) => {
    const texts = (request.body as { texts?: unknown } | null)?.texts;
    if (!Array.isArray(texts) || texts.length > 2000 || !texts.every((t) => typeof t === "string")) throw new HttpError(400, "Send the texts to check as a list.");
    try {
      return await drafting.checkSpelling(texts);
    } catch (error) {
      if (error instanceof DraftFailed) throw new HttpError(503, error.message);
      throw error;
    }
  });
}
