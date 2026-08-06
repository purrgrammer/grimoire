import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Force a single copy of React. Some transitive deps (e.g. react-dnd-multi-backend
    // via react-mosaic-component) declare react-dom peers capped at ^18, which makes npm
    // nest a React 18 copy. Bundling two Reacts fails at runtime, not build time:
    // the older copy reaches for internals like ReactCurrentDispatcher that React 19 removed.
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
