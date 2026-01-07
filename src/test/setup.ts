/**
 * Vitest setup file
 *
 * Polyfills browser APIs for Node.js test environment.
 */

// Polyfill IndexedDB - allows Dexie to work in tests
import "fake-indexeddb/auto";

// Polyfill WebSocket - required by nostr-tools relay code
import { WebSocket } from "ws";
// @ts-expect-error - polyfilling global WebSocket for Node.js
globalThis.WebSocket = WebSocket;
