import { createBrowserRouter, RouterProvider } from "react-router";
import { AppShell } from "./components/layouts/AppShell";
import DashboardPage from "./components/pages/DashboardPage";
import SpellbookPage from "./components/pages/SpellbookPage";

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