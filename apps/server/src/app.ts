/**
 * The web server: the API under /api and the built web app for every other path.
 *
 * Routes so far:
 *   GET /api/health       public; whether the app and its database are working. Holds no data.
 *   GET /api/dev/summary  development copies only (404 in production): the test data loaded.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import { APP_ID, APP_NAME, type OrganizationType } from "@crb/core";
import type { Config } from "./config.js";
import type { Pool } from "./db.js";
import { currentVersion } from "./migrate.js";
import { addSecurityHeaders } from "./security.js";

export interface AppOptions {
  config: Pick<Config, "env" | "webDist">;
  pool: Pool;
  version: string;
  logger?: FastifyServerOptions["logger"];
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

export async function buildApp({ config, pool, version, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: true });
  addSecurityHeaders(app);

  app.get("/api/health", async (_request, reply): Promise<Health> => {
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
    app.get("/api/dev/summary", async (): Promise<DevSummary> => {
      const { rows } = await pool.query<{ name: string; type: OrganizationType }>("SELECT name, type FROM organization ORDER BY created_at, name");
      return { environment: "development", migrations: await currentVersion(pool), organizations: rows };
    });
  }

  const index = path.join(config.webDist, "index.html");
  const hasWebApp = existsSync(index);
  if (hasWebApp) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      wildcard: false,
      index: false,
      setHeaders(reply, file) {
        // Built files have a content hash in their names, so they never change.
        const immutable = file.includes(`${path.sep}assets${path.sep}`);
        reply.header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  } else {
    app.log.warn(`No web app found at ${config.webDist}; only the API is served. Run npm run build.`);
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    const isPage = (request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/") && pathname !== "/api";
    if (isPage && hasWebApp) {
      // The web app handles its own routes (/reports/…), so every page path gets index.html.
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });

  app.setErrorHandler(async (error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, "Request failed");
    return reply.code(status).send({ error: status >= 500 ? "Something went wrong on the server." : error.message });
  });

  return app;
}
