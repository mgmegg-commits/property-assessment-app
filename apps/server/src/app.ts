/**
 * The web server.
 *
 *   GET /                 v1's front end (apps/v1-web), served unchanged
 *   /api/…, /files/…      v1's API (v1api.ts), on PostgreSQL
 *   GET /status           the status page (apps/web): app, database and version
 *   GET /api/health       public; whether the app and its database are working. Holds no data.
 *   GET /api/dev/summary  development copies only (404 in production): the test data loaded.
 *
 * Everything needs the password (v1's sign-in cookie) except the routes marked
 * public, the web app's own files under /app/, and its pages.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import { APP_ID, APP_NAME, type OrganizationType } from "@crb/core";
import { TooManyAttempts, WrongPassword, createAuth } from "./auth.js";
import type { ClaudeClient } from "./claude.js";
import type { Config } from "./config.js";
import type { Pool } from "./db.js";
import { DraftingService } from "./drafting.js";
import { currentVersion } from "./migrate.js";
import { addSecurityHeaders } from "./security.js";
import { Storage } from "./storage.js";
import { IMAGE_TYPES, LIMITS, registerV1Api, type OnReportSaved } from "./v1api.js";
import type { V1Page } from "./v1page.js";

/** Pages the React app (apps/web) answers. */
export const WEB_APP_PATHS = ["/status"];

export type AppConfig = Pick<Config, "env" | "webDist" | "password" | "sessionSecret" | "secureCookies" | "dataDir" | "draftModel" | "trainingExamples" | "claudeConfigured" | "publicUrl" | "timeZone">;

export interface AppOptions {
  config: AppConfig;
  pool: Pool;
  version: string;
  /** v1's front end, served at "/". */
  v1Page?: V1Page | null;
  /** The Claude client (a fake in tests); created from ANTHROPIC_API_KEY when needed otherwise. */
  claude?: ClaudeClient | null;
  /** Called when a report is saved, inside the save's transaction. */
  onReportSaved?: OnReportSaved;
  /** Extra routes (follow-up), given the same storage and auth. */
  extend?: (app: FastifyInstance, parts: AppParts) => void | Promise<void>;
  logger?: FastifyServerOptions["logger"];
}

export interface AppParts {
  storage: Storage;
  auth: ReturnType<typeof createAuth>;
}

export interface Health {
  status: "ok" | "error";
  app: string;
  name: string;
  version: string;
  database: "ok" | "unreachable";
}

export interface DevSummary {
  environment: "development";
  migrations: number;
  organizations: { name: string; type: OrganizationType }[];
}

declare module "fastify" {
  interface FastifyContextConfig {
    /** Reachable without signing in. */
    public?: boolean;
  }
}

export async function buildApp({ config, pool, version, v1Page = null, claude = null, onReportSaved, extend, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: LIMITS.json });
  addSecurityHeaders(app);

  // v1's page sends "content-type: application/json" with no body on some calls (sign-out, start a draft).
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(Object.assign(new Error("The request body isn't valid JSON."), { statusCode: 400 }), undefined);
    }
  });
  app.addContentTypeParser(IMAGE_TYPES, { parseAs: "buffer", bodyLimit: LIMITS.file }, (_request, body, done) => done(null, body));

  const storage = new Storage(pool, config.dataDir);
  await storage.init();
  const auth = createAuth(config);
  const drafting = new DraftingService(storage, claude, config, { error: (...args: unknown[]) => app.log.error(args.map(String).join(" ")) });
  // Not fatal: the app still starts (and its health check says so) when the database is down.
  await drafting.failInterruptedJobs().catch((error) => app.log.warn({ err: error }, "Couldn't mark interrupted drafting jobs as failed"));

  const isPublic = (request: FastifyRequest) =>
    request.routeOptions.config?.public === true || request.routeOptions.url === undefined || request.url.startsWith("/app/");
  app.addHook("onRequest", async (request, reply) => {
    if (!isPublic(request) && !auth.isAuthenticated(request)) return reply.code(401).send({ error: "Sign in first." });
  });

  if (v1Page) {
    const sendV1 = async (_request: FastifyRequest, reply: FastifyReply) => reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-cache")
      .header("content-security-policy", v1Page.contentSecurityPolicy)
      .send(v1Page.html);
    app.get("/", { config: { public: true } }, sendV1);
    app.get("/index.html", { config: { public: true } }, sendV1);
    app.get("/api/v1-version", { config: { public: true } }, async () => v1Page.version);
  }

  app.get("/api/health", { config: { public: true } }, async (_request, reply): Promise<Health> => {
    const base = { app: APP_ID, name: APP_NAME, version };
    try {
      await pool.query("SELECT 1");
      return { status: "ok", ...base, database: "ok" };
    } catch (error) {
      app.log.warn({ err: error }, "Health check: database unreachable");
      reply.code(503);
      return { status: "error", ...base, database: "unreachable" };
    }
  });

  if (config.env === "development") {
    app.get("/api/dev/summary", { config: { public: true } }, async (): Promise<DevSummary> => {
      const { rows } = await pool.query<{ name: string; type: OrganizationType }>("SELECT name, type FROM organization ORDER BY created_at, name");
      return { environment: "development", migrations: await currentVersion(pool), organizations: rows };
    });
  }

  registerV1Api(app, { storage, auth, drafting, config, ...(onReportSaved ? { onReportSaved } : {}) });
  if (extend) await extend(app, { storage, auth });

  const index = path.join(config.webDist, "index.html");
  const hasWebApp = existsSync(index);
  if (hasWebApp) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: "/app/",
      wildcard: false,
      index: false,
      setHeaders(reply, file) {
        // Built files have a content hash in their names, so they never change.
        const immutable = file.includes(`${path.sep}assets${path.sep}`);
        reply.header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  } else {
    app.log.warn(`No web app found at ${config.webDist}; its pages aren't served. Run npm run build.`);
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    const isPage = (request.method === "GET" || request.method === "HEAD") && WEB_APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (isPage && hasWebApp) {
      // The React app's pages all start from its index.html. They load their own data, and say when you need to sign in.
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });

  app.setErrorHandler(async (error: Error & { statusCode?: number; code?: string }, request, reply) => {
    let status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    let message = error.message;
    if (error instanceof TooManyAttempts) status = 429;
    if (error instanceof WrongPassword) status = 401;
    if (status === 415) message = "Only JPEG, PNG and WebP images can be stored.";
    if (status === 413) message = `Upload is larger than ${Math.round((request.url === "/api/files" ? LIMITS.file : LIMITS.json) / 1_048_576)} MB.`;
    if (status >= 500) request.log.error({ err: error }, "Request failed");
    return reply.code(status).send({ error: status >= 500 ? "Something went wrong on the website." : message });
  });

  return app;
}
