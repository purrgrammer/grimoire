import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Grimoire - Nostr Protocol Explorer",
        short_name: "Grimoire",
        description:
          "A Nostr protocol explorer and developer tool with a tiling window manager interface",
        theme_color: "#1a1a1a",
        background_color: "#1a1a1a",
        display: "standalone",
        scope: "/",
        start_url: "/",
        orientation: "any",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
        categories: ["productivity", "developer tools", "social"],
        shortcuts: [
          {
            name: "Open Command Palette",
            short_name: "Commands",
            description: "Open the command palette to run Nostr commands",
            url: "/?cmd=true",
            icons: [
              {
                src: "icon.svg",
                sizes: "any",
                type: "image/svg+xml",
              },
            ],
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
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
