import { ActionHub } from "applesauce-actions";
import eventStore from "./event-store";
import { EventFactory } from "applesauce-factory";

/**
 * Global action hub for Grimoire
 * Used to register and execute actions throughout the application
 */
export const hub = new ActionHub(eventStore, new EventFactory());
