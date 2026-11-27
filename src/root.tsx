import { RouterProvider } from "react-router";
import { router } from "./router";

export default function Root() {
  return <RouterProvider router={router} />;
}
