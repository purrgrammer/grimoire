import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { cacheEvents } from "./event-cache";
import { encryptedContentStorage } from "./rumor-storage";

const eventStore = new EventStore();

// Persist all events to Dexie cache for offline access
persistEventsToCache(eventStore, cacheEvents);

// Persist decrypted gift wrap content to Dexie
// This ensures we don't have to re-decrypt messages on every page load
// The storage handles both gift wraps (decrypted seal) and seals (decrypted rumor)
persistEncryptedContent(eventStore, encryptedContentStorage);

export default eventStore;
