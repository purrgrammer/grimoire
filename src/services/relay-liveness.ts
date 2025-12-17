/**
 * Relay Liveness Tracking Singleton
 *
 * Tracks relay health and connection states to deprioritize offline/dead relays.
 * Uses applesauce-relay's RelayLiveness to implement backoff strategies.
 */

import { RelayLiveness } from "applesauce-relay";
import pool from "./relay-pool";
import { relayLivenessStorage } from "./db";

// Create singleton liveness tracker with persistent storage
const liveness = new RelayLiveness({
  // Maximum failures before marking relay as dead
  maxFailuresBeforeDead: 5,
  // Base delay for backoff (30 seconds)
  backoffBaseDelay: 30 * 1000,
  // Maximum backoff delay (5 minutes)
  backoffMaxDelay: 5 * 60 * 1000,
  // Persistent storage using Dexie
  storage: relayLivenessStorage,
});

// Load persisted relay states on initialization
liveness.load().catch((error) => {
  console.warn("[RelayLiveness] Failed to load persisted state:", error);
});

// Connect to relay pool to automatically track relay health
liveness.connectToPool(pool);

export default liveness;
