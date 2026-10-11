import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The question bundle is generated, not committed. `npm run dev` and `npm run
// build` make it first; say so plainly when Vite is started some other way.
if (!existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "src", "worker", "questions.json"))) {
  throw new Error(
    "src/worker/questions.json is missing. It is generated from data/megalist-normalised.json: " +
      "run `npm run questions`, or start with `npm run dev` or `npm run build`, which do it for you."
  );
}

// `npm run dev:offline` runs without a Cloudflare sign-in. Workers AI (the Clef
// grader) is not reachable in that mode; graders called over HTTP still work.
export default defineConfig(({ mode }) => ({
  plugins: [react(), cloudflare({ remoteBindings: mode !== "offline" })],
  // Discord reaches the dev server through a cloudflared quick tunnel.
  server: { allowedHosts: [".trycloudflare.com"] },
}));
