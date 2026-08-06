import { createRoot } from "react-dom/client";
import { EventStoreProvider } from "applesauce-react/providers";
import Root from "./root";
import eventStore from "./services/event-store";
import "./index.css";
import "react-mosaic-component/react-mosaic-component.css";
import { Toaster } from "sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeErrorHandling } from "./lib/error-handler";
import { ThemeProvider } from "./lib/themes";
import { initSupporters } from "./services/supporters";

// Initialize global error handling
initializeErrorHandling();

// Initialize supporter tracking
initSupporters();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary level="app">
    <ThemeProvider defaultTheme="dark">
      <EventStoreProvider eventStore={eventStore}>
        <TooltipProvider>
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "hsl(var(--background))",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              },
            }}
          />
          <Root />
        </TooltipProvider>
      </EventStoreProvider>
    </ThemeProvider>
  </ErrorBoundary>,
);

// Register the service worker — production only. In dev it would cache Vite's
// hashed module URLs, which go dead whenever dependencies change and break
// dynamic imports.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("SW registration failed:", error);
    });
  });
} else if (import.meta.env.DEV && "serviceWorker" in navigator) {
  // Tear down any SW left over from an older build, and drop its caches.
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) registration.unregister();
  });
  if ("caches" in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        if (name.startsWith("grimoire-")) caches.delete(name);
      }
    });
  }
}
