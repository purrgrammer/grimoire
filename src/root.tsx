import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/layouts/AppShell";
import DashboardPage from "./components/pages/DashboardPage";
import SpellbookPage from "./components/pages/SpellbookPage";
import Nip19PreviewRouter from "./components/pages/Nip19PreviewRouter";
import RunCommandPage from "./components/pages/RunCommandPage";
import RouteErrorPage from "./components/pages/RouteErrorPage";

const errorElement = (
  <AppShell hideBottomBar>
    <RouteErrorPage />
  </AppShell>
);

const router = createBrowserRouter([
  {
    path: "/",
    errorElement,
    element: (
      <AppShell>
        <DashboardPage />
      </AppShell>
    ),
  },
  {
    path: "/run",
    errorElement,
    element: (
      <AppShell hideBottomBar>
        <RunCommandPage />
      </AppShell>
    ),
  },
  {
    path: "/preview/:actor/:identifier",
    errorElement,
    element: (
      <AppShell>
        <SpellbookPage />
      </AppShell>
    ),
  },
  // NIP-19 identifier preview route - must come before /:actor/:identifier catch-all
  {
    path: "/:identifier",
    errorElement,
    element: (
      <AppShell hideBottomBar>
        <Nip19PreviewRouter />
      </AppShell>
    ),
    // Only match single-segment paths that look like NIP-19 identifiers
    loader: ({ params }) => {
      const id = params.identifier;
      if (
        !id ||
        !(
          id.startsWith("npub1") ||
          id.startsWith("note1") ||
          id.startsWith("nevent1") ||
          id.startsWith("naddr1")
        )
      ) {
        throw new Response("Not Found", { status: 404 });
      }
      return null;
    },
  },
  // Catch-all for two-segment paths (spellbooks, etc.)
  {
    path: "/:actor/:identifier",
    errorElement,
    element: (
      <AppShell>
        <SpellbookPage />
      </AppShell>
    ),
  },
  // Anything that matches no route above (3+ segments, etc.). Throwing from
  // the loader routes it through errorElement as a real 404 rather than
  // rendering the error page with no error to report.
  {
    path: "*",
    errorElement,
    loader: () => {
      throw new Response("Not Found", { status: 404 });
    },
    element: null,
  },
]);

export default function Root() {
  return <RouterProvider router={router} />;
}
