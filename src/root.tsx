import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/layouts/AppShell";
import DashboardPage from "./components/pages/DashboardPage";
import SpellbookPage from "./components/pages/SpellbookPage";
import Nip19PreviewRouter from "./components/pages/Nip19PreviewRouter";
import RunCommandPage from "./components/pages/RunCommandPage";

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <AppShell>
        <DashboardPage />
      </AppShell>
    ),
  },
  {
    path: "/run",
    element: <RunCommandPage />,
  },
  {
    path: "/preview/:actor/:identifier",
    element: (
      <AppShell>
        <SpellbookPage />
      </AppShell>
    ),
  },
  // NIP-19 identifier preview route - must come before /:actor/:identifier catch-all
  {
    path: "/:identifier",
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
    element: (
      <AppShell>
        <SpellbookPage />
      </AppShell>
    ),
  },
]);

export default function Root() {
  return <RouterProvider router={router} />;
}
