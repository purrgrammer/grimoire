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

// Add dark class to html element for default dark theme
document.documentElement.classList.add("dark");

// Initialize global error handling
initializeErrorHandling();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary level="app">
    <EventStoreProvider eventStore={eventStore}>
      <TooltipProvider>
        <Toaster
          position="top-center"
          theme="dark"
          toastOptions={{
            style: {
              background: "hsl(var(--background))",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 0,
            },
          }}
        />
        <Root />
      </TooltipProvider>
    </EventStoreProvider>
  </ErrorBoundary>,
);
