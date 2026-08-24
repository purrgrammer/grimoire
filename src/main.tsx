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
// Side-effect import: the module initializes the log on load. It has to run at
// startup, not when the log window first opens, or everything before that point
// goes unrecorded. The log is a fixed-size ring buffer, so this costs no memory
// growth.
import "./services/event-log";

/**
 * Never boot grimoire inside grimoire.
 *
 * An nsite runs in a same-origin iframe, and the worker that serves it answers
 * from a map of which frame is which site. When that map misses — a restarted
 * worker, a request that arrived before the mapping was recorded — the request
 * falls through to the network, and at `/` the network serves grimoire's own
 * index.html. Without this guard grimoire then boots inside the nsite's frame,
 * mounts a whole app, and does it again for every frame that app opens. It is
 * not subtle when it happens: nested grimoire windows, all the way down.
 *
 * Cheap to prevent and worth preventing outright rather than relying on the map
 * never missing. A same-origin parent means this document is the fallthrough,
 * not a page anyone asked for, so it renders a dead end instead of an app.
 */
function insideGrimoire(): boolean {
  if (window.parent === window) return false;
  try {
    // Throws for a cross-origin parent, which is somebody embedding grimoire
    // deliberately — not this failure, and not ours to refuse.
    return window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

if (insideGrimoire()) {
  document.getElementById("root")!.textContent =
    "This nsite could not be served. Close the window and run it again.";
} else {
  boot();
}

function boot() {
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
}

// Register the service worker — production only. In dev it would cache Vite's
// hashed module URLs, which go dead whenever dependencies change and break
// dynamic imports.
//
// Skipped entirely inside a frame. A grimoire that loaded there is the
// fallthrough this file refuses to boot, and letting it run the dev teardown
// below would unregister the very worker that serves nsites — from inside a
// window that only exists because that worker missed.
if (insideGrimoire()) {
  // nothing
} else if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("SW registration failed:", error);
    });
  });
} else if (import.meta.env.DEV && "serviceWorker" in navigator) {
  // Tear down any SW left over from an older build. An already-controlling
  // worker keeps serving this client until unload, so reload once after
  // unregistering — otherwise the first dev session still gets stale modules.
  void (async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) return;

    // A dev-mode worker is exempt. `?mode=dev` disables every caching path in
    // `sw.js`, so it cannot cache Vite's module URLs — the hazard this teardown
    // exists for — and it is the only thing serving a running nsite's files.
    const stale = registrations.filter(
      (r) =>
        !(r.active ?? r.waiting ?? r.installing)?.scriptURL.includes(
          "mode=dev",
        ),
    );
    if (stale.length === 0) return;

    const wasControlled = Boolean(navigator.serviceWorker.controller);
    await Promise.all(stale.map((r) => r.unregister()));

    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("grimoire-"))
          .map((name) => caches.delete(name)),
      );
    }

    if (wasControlled) location.reload();
  })();
}
