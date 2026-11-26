# The app image: the server and the built web app. The same image runs on a
# Mac (Docker Desktop), Cecil's computer, a managed host or a cloud server.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /src/package.json ./
COPY --from=build --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/packages/core/package.json packages/core/
COPY --from=build --chown=node:node /src/packages/core/dist packages/core/dist
COPY --from=build --chown=node:node /src/apps/server/package.json apps/server/
COPY --from=build --chown=node:node /src/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /src/apps/server/migrations apps/server/migrations
COPY --from=build --chown=node:node /src/apps/web/dist apps/web/dist
# v1's front end, built from the pinned commit in apps/v1-web/VERSION.json.
COPY --chown=node:node apps/v1-web apps/v1-web
# Photos live here (a volume in compose.yaml); the app runs as "node" and owns it.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/server/dist/main.js"]
