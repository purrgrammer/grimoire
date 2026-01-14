import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";
import { persistEncryptedContent } from "applesauce-common/helpers";
import { cacheEvents } from "./event-cache";
import { rumorStorage, setCurrentPubkey } from "./rumor-storage";
import accountManager from "./accounts";
import { of } from "rxjs";

const eventStore = new EventStore();

// Persist all events to Dexie cache for offline access
persistEventsToCache(eventStore, cacheEvents);

// Persist decrypted gift wrap content to Dexie
// This ensures we don't have to re-decrypt messages on every page load
persistEncryptedContent(eventStore, of(rumorStorage));

// Sync current pubkey for rumor storage when account changes
accountManager.active$.subscribe((account) => {
  setCurrentPubkey(account?.pubkey ?? null);
});

export default eventStore;
