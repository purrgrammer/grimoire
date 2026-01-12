/**
 * Vitest setup file
 *
 * Polyfills browser APIs for Node.js test environment.
 */

// Polyfill IndexedDB - allows Dexie to work in tests
import "fake-indexeddb/auto";

// Polyfill WebSocket - required by nostr-tools relay code
import { WebSocket } from "ws";
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

// Polyfill localStorage - required by state management and accounts
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
globalThis.localStorage = localStorageMock as Storage;
