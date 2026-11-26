import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    // Use @crb/core's TypeScript source directly, so the web app never needs it built first.
    alias: { "@crb/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // No inline scripts or styles, so the server's content security policy can stay strict.
    assetsInlineLimit: 0,
  },
  server: {
    // npm run dev:web talks to npm run dev:server.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
