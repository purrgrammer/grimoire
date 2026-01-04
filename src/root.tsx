import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/layouts/AppShell";
import DashboardPage from "./components/pages/DashboardPage";
import SpellbookPage from "./components/pages/SpellbookPage";
import PreviewProfilePage from "./components/pages/PreviewProfilePage";
import PreviewEventPage from "./components/pages/PreviewEventPage";
import PreviewAddressPage from "./components/pages/PreviewAddressPage";

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
    path: "/npub:identifier",
    element: (
      <AppShell hideBottomBar>
        <PreviewProfilePage />
      </AppShell>
    ),
  },
  {
    path: "/nevent:identifier",
    element: (
      <AppShell hideBottomBar>
        <PreviewEventPage />
      </AppShell>
    ),
  },
  {
    path: "/note:identifier",
    element: (
      <AppShell hideBottomBar>
        <PreviewEventPage />
      </AppShell>
    ),
  },
  {
    path: "/naddr:identifier",
    element: (
      <AppShell hideBottomBar>
        <PreviewAddressPage />
      </AppShell>
    ),
  },
  {
    path: "/preview/:actor/:identifier",
    element: (
      <AppShell>
        <SpellbookPage />
      </AppShell>
    ),
  },
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
