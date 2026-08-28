import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * WebMCP (`document.modelContext`) refuses to register a tool unless the
 * document sits in an origin-keyed agent cluster, and that is decided by a
 * response header — there is no `<meta>` equivalent and no way to opt in from
 * script. Without it every `registerTool()` rejects with `SecurityError` and
 * the browser's agent sees a page with no tools at all. Set here for `dev` and
 * `preview`; the deployed origin sets it in `vercel.json`.
 *
 * Origin-keying only narrows what may reach this document synchronously
 * (same-site `document.domain` access, which nothing here uses).
 */
const ORIGIN_KEYED = { "Origin-Agent-Cluster": "?1" };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Force a single React copy; a nested React 18 fails at runtime only.
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Resolve workspace package source directly (bypasses dist/)
      "relay-auth-manager": path.resolve(
        __dirname,
        "./packages/relay-auth-manager/src/index.ts",
      ),
    },
  },
  server: {
    hmr: {
      overlay: true,
    },
    /*
     * Every nsite runs on `<aggregate>.localhost`, its own origin, so that it
     * cannot reach grimoire's localStorage, database or service worker. No DNS
     * or certificate is needed — browsers resolve every `.localhost` label to
     * loopback and treat it as a secure context — but Vite rejects host headers
     * it was not told about, as protection against DNS rebinding. Loopback
     * names cannot be rebound to somewhere else, so allowing them costs nothing
     * that protection was defending.
     */
    allowedHosts: [".localhost"],
    headers: ORIGIN_KEYED,
  },
  preview: {
    headers: ORIGIN_KEYED,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React foundation - most stable, everything depends on it
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          // UI libraries - only depend on React, safe to separate
          if (
            id.includes("node_modules/@radix-ui/") ||
            id.includes("node_modules/react-mosaic-component")
          ) {
            return "ui";
          }

          // Nostr ecosystem - keep tightly coupled libraries together
          // This prevents "rxjs functions not found" errors by keeping
          // applesauce + rxjs + nostr-tools + dexie in one chunk
          if (
            id.includes("node_modules/applesauce-") ||
            id.includes("node_modules/nostr-tools") ||
            id.includes("node_modules/rxjs") ||
            id.includes("node_modules/dexie")
          ) {
            return "nostr";
          }

          // Markdown rendering - lazy loaded, can be separate
          if (
            id.includes("node_modules/react-markdown") ||
            id.includes("node_modules/remark-") ||
            id.includes("node_modules/unified") ||
            id.includes("node_modules/micromark")
          ) {
            return "markdown";
          }

          // Let Vite handle everything else automatically
        },
      },
    },
  },
});
