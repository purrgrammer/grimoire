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

// Register service worker for PWA functionality
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("SW registered:", registration);
      })
      .catch((error) => {
        console.log("SW registration failed:", error);
      });
  });
}
