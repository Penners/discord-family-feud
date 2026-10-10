import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev:offline` runs without a Cloudflare sign-in. Workers AI (the Clef
// grader) is not reachable in that mode; graders called over HTTP still work.
export default defineConfig(({ mode }) => ({
  plugins: [react(), cloudflare({ remoteBindings: mode !== "offline" })],
  // Discord reaches the dev server through a cloudflared quick tunnel.
  server: { allowedHosts: [".trycloudflare.com"] },
}));
