import { createRoot } from "react-dom/client";
import { EventStoreProvider } from "applesauce-react/providers";
import Root from "./root";
import eventStore from "./services/event-store";
import "./index.css";
import "react-mosaic-component/react-mosaic-component.css";

// Add dark class to html element for default dark theme
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <EventStoreProvider eventStore={eventStore}>
    <Root />
  </EventStoreProvider>,
);
