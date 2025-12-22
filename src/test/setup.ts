/**
 * Vitest setup file
 *
 * Polyfills IndexedDB for Node.js test environment.
 * This allows Dexie to work in tests without a browser.
 */
import "fake-indexeddb/auto";
