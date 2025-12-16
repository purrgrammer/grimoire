/**
 * Relay Liveness Tracking Singleton
 *
 * Tracks relay health and connection states to deprioritize offline/dead relays.
 * Uses applesauce-relay's RelayLiveness to implement backoff strategies.
 */

import { RelayLiveness } from "applesauce-relay";
import pool from "./relay-pool";

// Create singleton liveness tracker
const liveness = new RelayLiveness({
  // Maximum failures before marking relay as dead
  maxFailuresBeforeDead: 5,
  // Base delay for backoff (30 seconds)
  backoffBaseDelay: 30 * 1000,
  // Maximum backoff delay (5 minutes)
  backoffMaxDelay: 5 * 60 * 1000,
  // TODO: Add persistent storage using Dexie
  // storage: undefined,
});

// Connect to relay pool to automatically track relay health
liveness.connectToPool(pool);

export default liveness;
