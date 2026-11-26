import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@crb/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/**/*.test.{ts,mjs}", "apps/*/test/**/*.test.ts"],
    globalSetup: ["tests/setup/database.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
