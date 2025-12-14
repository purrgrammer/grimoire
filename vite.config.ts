import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
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
          // Applesauce packages - Nostr core functionality
          if (id.includes("applesauce-")) {
            return "applesauce";
          }

          // UI component library - Radix UI + Mosaic
          if (
            id.includes("@radix-ui/") ||
            id.includes("react-mosaic-component")
          ) {
            return "ui";
          }

          // Nostr tools
          if (id.includes("nostr-tools")) {
            return "nostr";
          }

          // Markdown rendering (lazy loaded but still chunk separately)
          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("unified") ||
            id.includes("micromark")
          ) {
            return "markdown";
          }

          // RxJS
          if (id.includes("rxjs")) {
            return "rxjs";
          }

          // React core + DOM
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/")
          ) {
            return "react-vendor";
          }

          // Dexie database
          if (id.includes("dexie")) {
            return "dexie";
          }

          // All other node_modules
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
      },
    },
  },
});
