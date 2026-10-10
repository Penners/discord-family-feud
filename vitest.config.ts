import { defineConfig } from "vitest/config";

// The engine and grader tests are plain TypeScript, so they run in Node
// without the Cloudflare or React plugins from vite.config.ts.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
