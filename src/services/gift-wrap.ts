import { BehaviorSubject, Subject, Subscription, filter, map } from "rxjs";
import { kinds } from "applesauce-core/helpers/event";
import {
  isGiftWrapUnlocked,
  getGiftWrapRumor,
  unlockGiftWrap,
} from "applesauce-common/helpers/gift-wrap";
import {
  getConversationIdentifierFromMessage,
  getConversationParticipants,
} from "applesauce-common/helpers/messages";
import { persistEncryptedContent } from "applesauce-common/helpers/encrypted-content-cache";
import type { NostrEvent } from "@/types/nostr";
import type { ISigner } from "applesauce-signers";
import eventStore from "./event-store";
import pool from "./relay-pool";
import {
  encryptedContentStorage,
  getStoredEncryptedContentIds,
  saveGiftWraps,
  loadStoredGiftWraps,
} from "./db";
import { AGGREGATOR_RELAYS } from "./loaders";
import relayListCache from "./relay-list-cache";
import { normalizeRelayURL } from "@/lib/relay-url";
import { dmDebug, dmInfo, dmWarn } from "@/lib/dm-debug";

/** Kind 10050: DM relay list (NIP-17) */
const DM_RELAY_LIST_KIND = 10050;

/** Kind 14: Private direct message (NIP-17) */
const PRIVATE_DM_KIND = 14;

/** Rumor is an unsigned event - used for gift wrap contents */
export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/** Status of a gift wrap decryption */
export type DecryptStatus = "pending" | "decrypting" | "success" | "error";

export interface DecryptState {
  status: DecryptStatus;
  error?: string;
  decryptedAt?: number;
}

export interface Conversation {
  id: string;
  participants: string[];
  lastMessage?: Rumor;
  lastGiftWrap?: NostrEvent;
  unreadCount?: number;
}

/** Settings for the inbox service */
export interface InboxSettings {
  enabled: boolean;
  autoDecrypt: boolean;
}

const SETTINGS_KEY = "grimoire-inbox-settings";

function loadSettings(): InboxSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore
  }
  return { enabled: false, autoDecrypt: false };
}

function saveSettings(settings: InboxSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

class GiftWrapService {
  /** Current user pubkey (null if not initialized) */
  userPubkey: string | null = null;
  /** Current signer for decryption */
  private signer: ISigner | null = null;

  /** Map of gift wrap ID -> decrypt state */
  private decryptStates = new Map<string, DecryptState>();
  /** Observable for decrypt state changes */
  readonly decryptStates$ = new BehaviorSubject<Map<string, DecryptState>>(
    new Map(),
  );

  /** All gift wraps for the current user */
  private giftWraps: NostrEvent[] = [];
  readonly giftWraps$ = new BehaviorSubject<NostrEvent[]>([]);

  /** Conversations grouped by participants (NIP-17 kind 14 messages only) */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  /**
   * All decrypted rumors (any kind, not just DMs)
   * The full rumor event is preserved including: id, pubkey, created_at, kind, tags, content
   * This allows future support for any kind sent via gift wrap (messages, files, etc.)
   */
  readonly decryptedRumors$ = new BehaviorSubject<
    Array<{ giftWrap: NostrEvent; rumor: Rumor }>
  >([]);

  /** Inbox relays (kind 10050) */
  readonly inboxRelays$ = new BehaviorSubject<string[]>([]);

  /** Settings */
  readonly settings$ = new BehaviorSubject<InboxSettings>(loadSettings());

  /** Sync status */
  readonly syncStatus$ = new BehaviorSubject<
    "idle" | "syncing" | "error" | "disabled"
  >("idle");

  /** Event emitter for decrypt events */
  readonly decryptEvent$ = new Subject<{
    giftWrapId: string;
    status: DecryptStatus;
    rumor?: Rumor;
    error?: string;
  }>();

  /** Pending count observable for UI display */
  readonly pendingCount$ = new BehaviorSubject<number>(0);

  private subscriptions: Subscription[] = [];
  private relaySubscription: Subscription | null = null;
  private persistenceCleanup: (() => void) | null = null;
  /** IDs of gift wraps that have persisted decrypted content */
  private persistedIds = new Set<string>();
  /** Whether encrypted content cache is ready for access */
  private cacheReady = false;

  constructor() {
    // Start encrypted content persistence
    this.persistenceCleanup = persistEncryptedContent(
      eventStore,
      encryptedContentStorage,
    );
  }

  /** Wait for encrypted content cache to be accessible */
  private async waitForCacheReady(): Promise<void> {
    // If no persisted IDs, cache is ready (nothing to wait for)
    if (this.persistedIds.size === 0) {
      this.cacheReady = true;
      return;
    }

    // Try to access cache to confirm it's loaded
    const testId = Array.from(this.persistedIds)[0];
    const maxAttempts = 10;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await encryptedContentStorage.getItem(testId);
        this.cacheReady = true;
        dmDebug(
          "GiftWrap",
          `Encrypted content cache ready after ${attempt} attempts`,
        );
        return;
      } catch {
        // Cache not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // After max attempts, proceed anyway (cache might be empty)
    dmWarn(
      "GiftWrap",
      `Cache readiness check timed out after ${maxAttempts} attempts, proceeding anyway`,
    );
    this.cacheReady = true;
  }

  /** Initialize the service with user pubkey and signer */
  async init(pubkey: string, signer: ISigner | null) {
    this.cleanup();
    this.userPubkey = pubkey;
    this.signer = signer;
    this.decryptStates.clear();
    this.decryptStates$.next(new Map());
    this.pendingCount$.next(0);

    // Only perform expensive operations if inbox sync is enabled
    // This prevents automatic network requests and heavy I/O on login
    if (!this.settings$.value.enabled) {
      dmDebug("GiftWrap", "Inbox sync disabled, skipping initialization");
      return;
    }

    dmInfo("GiftWrap", `Initializing inbox sync for ${pubkey.slice(0, 8)}`);

    // Load persisted encrypted content IDs to know which gift wraps are already decrypted
    this.persistedIds = await getStoredEncryptedContentIds();

    // Wait for encrypted content cache to be accessible
    await this.waitForCacheReady();

    // Load inbox relays (kind 10050)
    this.loadInboxRelays();

    // Subscribe to event updates to detect when cache restoration completes
    const updateSub = eventStore.update$.subscribe((event) => {
      if (
        event.kind === kinds.GiftWrap &&
        this.giftWraps.some((g) => g.id === event.id)
      ) {
        // A gift wrap was updated (possibly restored from cache)
        // Check if it's now unlocked and update state accordingly
        if (isGiftWrapUnlocked(event)) {
          const currentState = this.decryptStates.get(event.id);
          if (currentState?.status === "pending") {
            this.decryptStates.set(event.id, {
              status: "success",
              decryptedAt: Date.now(),
            });
            this.decryptStates$.next(new Map(this.decryptStates));
            this.updatePendingCount();
            this.updateConversations();
          }
        }
      }
    });
    this.subscriptions.push(updateSub);

    // Load stored gift wraps and start syncing
    await this.loadStoredGiftWraps();
    this.startSync();
  }

  /** Load stored gift wraps from Dexie into EventStore */
  private async loadStoredGiftWraps() {
    if (!this.userPubkey) return;

    try {
      const storedEvents = await loadStoredGiftWraps(this.userPubkey);
      if (storedEvents.length > 0) {
        dmInfo(
          "GiftWrap",
          `Loading ${storedEvents.length} stored gift wraps from cache`,
        );
        // Add stored events to EventStore - this triggers the timeline subscription
        for (const event of storedEvents) {
          eventStore.add(event);
        }

        // Update conversations from loaded gift wraps (they're already decrypted from cache)
        // Without this, conversations don't appear until sync fetches from relays
        this.updateConversations();
        dmDebug(
          "GiftWrap",
          `Rebuilt conversations from ${storedEvents.length} stored gift wraps`,
        );
      }
    } catch (err) {
      console.warn(`[GiftWrap] Error loading stored gift wraps:`, err);
    }
  }

  /** Update settings */
  updateSettings(settings: Partial<InboxSettings>) {
    const newSettings = { ...this.settings$.value, ...settings };
    this.settings$.next(newSettings);
    saveSettings(newSettings);

    // Handle enabled state change
    if (settings.enabled !== undefined) {
      if (settings.enabled) {
        this.startSync();
      } else {
        this.stopSync();
      }
    }

    // Handle auto-decrypt change
    if (settings.autoDecrypt && this.signer) {
      this.autoDecryptPending();
    }
  }

  /** Load inbox relays from kind 10050 event */
  private async loadInboxRelays() {
    if (!this.userPubkey) return;

    // Subscribe to reactive updates from EventStore
    const sub = eventStore
      .replaceable(DM_RELAY_LIST_KIND, this.userPubkey)
      .pipe(
        filter((e) => e !== undefined),
        map((event) => {
          if (!event) return [];
          // Extract relay URLs from tags and normalize them
          return event.tags
            .filter((tag) => tag[0] === "relay")
            .map((tag) => tag[1])
            .filter(Boolean)
            .map((url) => {
              try {
                return normalizeRelayURL(url);
              } catch (err) {
                console.warn(
                  `[GiftWrap] Failed to normalize inbox relay URL: ${url}`,
                  err,
                );
                return null;
              }
            })
            .filter((url): url is string => url !== null);
        }),
      )
      .subscribe((relays) => {
        const hadRelays = this.inboxRelays$.value.length > 0;
        this.inboxRelays$.next(relays);

        // If we just got inbox relays and sync is enabled, restart sync with new relays
        if (!hadRelays && relays.length > 0 && this.settings$.value.enabled) {
          console.log(
            `[GiftWrap] Discovered ${relays.length} inbox relays, restarting sync`,
          );
          this.startSync();
        }
      });

    this.subscriptions.push(sub);

    // Also fetch the inbox relay list from user's outbox relays
    // This ensures we load it on page reload when EventStore is empty
    await this.fetchInboxRelayList();
  }

  /** Fetch the user's inbox relay list (kind 10050) from their outbox relays */
  private async fetchInboxRelayList() {
    if (!this.userPubkey) return;

    try {
      // Get user's outbox relays to query for their inbox relay list
      const outboxRelays = await relayListCache.getOutboxRelays(
        this.userPubkey,
      );
      const relaysToQuery =
        outboxRelays && outboxRelays.length > 0
          ? outboxRelays
          : AGGREGATOR_RELAYS;

      dmDebug(
        "GiftWrap",
        `Fetching inbox relay list from ${relaysToQuery.length} relays`,
      );

      // Request the user's DM relay list
      pool
        .request(
          relaysToQuery,
          [{ kinds: [DM_RELAY_LIST_KIND], authors: [this.userPubkey] }],
          { eventStore },
        )
        .subscribe({
          error: (err) => {
            dmWarn("GiftWrap", `Error fetching inbox relay list: ${err}`);
          },
        });
    } catch (err) {
      dmWarn("GiftWrap", `Error in fetchInboxRelayList: ${err}`);
    }
  }

  /** Start syncing gift wraps from inbox relays */
  startSync() {
    if (!this.userPubkey) {
      this.syncStatus$.next("disabled");
      return;
    }

    const inboxRelays = this.inboxRelays$.value;
    // Use inbox relays if available, otherwise use aggregator relays as fallback
    const relaysToUse =
      inboxRelays.length > 0 ? inboxRelays : AGGREGATOR_RELAYS;

    dmInfo(
      "GiftWrap",
      `Starting sync with ${relaysToUse.length} relays (inbox: ${inboxRelays.length})`,
    );

    this.syncStatus$.next("syncing");
    this.subscribeToGiftWraps(relaysToUse);
  }

  /** Stop syncing */
  stopSync() {
    this.syncStatus$.next("disabled");
    if (this.relaySubscription) {
      this.relaySubscription.unsubscribe();
      this.relaySubscription = null;
    }
  }

  /** Subscribe to gift wraps for current user with batched relay connections */
  private subscribeToGiftWraps(relays: string[]) {
    if (!this.userPubkey) return;

    // Subscribe to gift wraps addressed to this user
    const reqFilter = {
      kinds: [kinds.GiftWrap],
      "#p": [this.userPubkey],
    };

    // Use timeline observable for reactive updates
    dmDebug(
      "GiftWrap",
      `Setting up timeline subscription for user ${this.userPubkey?.slice(0, 8)}`,
    );
    const sub = eventStore
      .timeline(reqFilter)
      .pipe(map((events) => events.sort((a, b) => b.created_at - a.created_at)))
      .subscribe((giftWraps) => {
        dmDebug("GiftWrap", `Timeline update: ${giftWraps.length} gift wraps`);

        // Find new gift wraps that we haven't seen before
        const newGiftWraps = giftWraps.filter(
          (gw) => !this.giftWraps.some((existing) => existing.id === gw.id),
        );

        if (newGiftWraps.length > 0) {
          dmDebug("GiftWrap", `Found ${newGiftWraps.length} new gift wraps`);
        }

        this.giftWraps = giftWraps;
        this.giftWraps$.next(giftWraps);

        // Update decrypt states for new gift wraps
        for (const gw of giftWraps) {
          if (!this.decryptStates.has(gw.id)) {
            // Check both in-memory unlock state and persisted IDs
            // Persisted IDs indicate content was decrypted in a previous session
            const hasSymbol = isGiftWrapUnlocked(gw);
            const hasPersisted = this.persistedIds.has(gw.id);
            const isUnlocked = hasSymbol || hasPersisted;

            this.decryptStates.set(gw.id, {
              status: isUnlocked ? "success" : "pending",
              decryptedAt: isUnlocked ? Date.now() : undefined,
            });
          }
        }
        this.decryptStates$.next(new Map(this.decryptStates));
        this.updatePendingCount();

        // Persist new gift wraps to Dexie for fast loading on next startup
        if (newGiftWraps.length > 0 && this.userPubkey) {
          saveGiftWraps(newGiftWraps, this.userPubkey).catch((err) => {
            console.warn(`[GiftWrap] Error saving gift wraps:`, err);
          });
        }

        // Update conversations
        this.updateConversations();

        // Auto-decrypt if enabled
        if (this.settings$.value.autoDecrypt && this.signer) {
          this.autoDecryptPending();
        }

        this.syncStatus$.next("idle");
      });

    this.relaySubscription = sub;

    // Progressive relay connection strategy to prevent overwhelming the browser
    // Connect to relays in batches with delays to allow AUTH to complete
    const INITIAL_BATCH_SIZE = 3; // Start with top 3 relays
    const BATCH_SIZE = 2; // Then add 2 at a time
    const BATCH_DELAY_MS = 1500; // 1.5s between batches (allows AUTH to complete)

    if (relays.length === 0) {
      dmWarn("GiftWrap", "No relays to connect to");
      return;
    }

    dmInfo(
      "GiftWrap",
      `Connecting to ${relays.length} inbox relays progressively (batches of ${INITIAL_BATCH_SIZE}, then ${BATCH_SIZE})`,
    );

    // Connect to first batch immediately (most important relays)
    const firstBatch = relays.slice(0, INITIAL_BATCH_SIZE);
    dmInfo("GiftWrap", `Batch 1: Connecting to ${firstBatch.length} relays`);

    const relaySubscription = pool
      .subscription(firstBatch, [reqFilter], { eventStore })
      .subscribe({
        next: (response) => {
          if (typeof response === "object" && response && "id" in response) {
            dmDebug(
              "GiftWrap",
              `Received gift wrap ${response.id.slice(0, 8)}`,
            );
          }
        },
        error: (err) => {
          dmWarn("GiftWrap", `Relay subscription error: ${err}`);
        },
      });

    // Store relay subscription for cleanup
    this.subscriptions.push(relaySubscription);

    // Connect to remaining relays progressively in batches
    const remainingRelays = relays.slice(INITIAL_BATCH_SIZE);
    if (remainingRelays.length > 0) {
      dmInfo(
        "GiftWrap",
        `Will connect to ${remainingRelays.length} more relays progressively`,
      );

      // Progressive batching with delays
      let batchNumber = 2;
      for (let i = 0; i < remainingRelays.length; i += BATCH_SIZE) {
        const batch = remainingRelays.slice(i, i + BATCH_SIZE);
        const delay = batchNumber * BATCH_DELAY_MS;

        // Schedule this batch connection
        setTimeout(() => {
          dmInfo(
            "GiftWrap",
            `Batch ${batchNumber}: Connecting to ${batch.length} more relays`,
          );

          const batchSub = pool
            .subscription(batch, [reqFilter], { eventStore })
            .subscribe({
              next: (response) => {
                if (
                  typeof response === "object" &&
                  response &&
                  "id" in response
                ) {
                  dmDebug(
                    "GiftWrap",
                    `Received gift wrap ${response.id.slice(0, 8)} from batch ${batchNumber}`,
                  );
                }
              },
              error: (err) => {
                dmWarn(
                  "GiftWrap",
                  `Batch ${batchNumber} subscription error: ${err}`,
                );
              },
            });

          this.subscriptions.push(batchSub);
        }, delay);

        batchNumber++;
      }
    }
  }

  /** Update pending count for UI display */
  private updatePendingCount() {
    let count = 0;
    for (const state of this.decryptStates.values()) {
      if (state.status === "pending" || state.status === "decrypting") {
        count++;
      }
    }
    this.pendingCount$.next(count);
  }

  /**
   * Update conversations and decrypted rumors from gift wraps.
   * Applesauce persistence stores the full JSON representation of rumors,
   * preserving all fields (id, pubkey, created_at, kind, tags, content).
   */
  private updateConversations() {
    // Wait for cache to be ready before processing conversations
    // This prevents the race condition where persistedIds indicates "unlocked"
    // but getGiftWrapRumor() returns null because cache hasn't loaded yet
    if (!this.cacheReady) {
      console.log(`[GiftWrap] Cache not ready, deferring conversation update`);
      return;
    }

    console.log(
      `[GiftWrap] Updating conversations from ${this.giftWraps.length} gift wraps`,
    );
    const conversationMap = new Map<string, Conversation>();
    const allRumors: Array<{ giftWrap: NostrEvent; rumor: Rumor }> = [];

    for (const gw of this.giftWraps) {
      // Check both in-memory unlock state AND persisted IDs
      // This is critical: gift wraps we just sent have the symbol,
      // but after reload they only have persisted IDs
      const isUnlocked = isGiftWrapUnlocked(gw) || this.persistedIds.has(gw.id);

      if (!isUnlocked) {
        console.log(
          `[GiftWrap] Skipping locked gift wrap ${gw.id.slice(0, 8)}`,
        );
        continue;
      }

      const rumor = getGiftWrapRumor(gw);
      if (!rumor) {
        console.log(
          `[GiftWrap] Gift wrap ${gw.id.slice(0, 8)} has no rumor (might need to load from cache)`,
        );
        continue;
      }

      // Collect all decrypted rumors (any kind) for future use
      allRumors.push({ giftWrap: gw, rumor });

      // Only group NIP-17 DMs (kind 14) into conversations
      if (rumor.kind !== PRIVATE_DM_KIND) continue;

      const convId = getConversationIdentifierFromMessage(rumor);
      const existing = conversationMap.get(convId);

      if (
        !existing ||
        rumor.created_at > (existing.lastMessage?.created_at ?? 0)
      ) {
        conversationMap.set(convId, {
          id: convId,
          participants: getConversationParticipants(rumor),
          lastMessage: rumor,
          lastGiftWrap: gw,
        });
      }
    }

    // Sort rumors by created_at descending
    allRumors.sort((a, b) => b.rumor.created_at - a.rumor.created_at);
    this.decryptedRumors$.next(allRumors);

    const conversations = Array.from(conversationMap.values()).sort(
      (a, b) =>
        (b.lastMessage?.created_at ?? 0) - (a.lastMessage?.created_at ?? 0),
    );

    console.log(
      `[GiftWrap] 💬 Updated conversations: ${conversations.length} conversations, ${allRumors.length} total rumors`,
    );

    this.conversations$.next(conversations);
  }

  /** Decrypt a single gift wrap */
  async decrypt(giftWrapId: string): Promise<Rumor | null> {
    if (!this.signer) {
      throw new Error("No signer available");
    }

    const gw = this.giftWraps.find((g) => g.id === giftWrapId);
    if (!gw) {
      throw new Error("Gift wrap not found");
    }

    // Check if already decrypted
    if (isGiftWrapUnlocked(gw)) {
      return getGiftWrapRumor(gw) ?? null;
    }

    // Update state to decrypting
    this.decryptStates.set(giftWrapId, { status: "decrypting" });
    this.decryptStates$.next(new Map(this.decryptStates));
    this.updatePendingCount();

    try {
      const rumor = await unlockGiftWrap(gw, this.signer);

      // Add to persisted IDs so it's recognized on next reload
      this.persistedIds.add(giftWrapId);

      // Update state to success
      this.decryptStates.set(giftWrapId, {
        status: "success",
        decryptedAt: Date.now(),
      });
      this.decryptStates$.next(new Map(this.decryptStates));
      this.updatePendingCount();

      // Emit decrypt event
      this.decryptEvent$.next({
        giftWrapId,
        status: "success",
        rumor,
      });

      // Update conversations
      this.updateConversations();

      return rumor;
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";

      // Update state to error
      this.decryptStates.set(giftWrapId, { status: "error", error });
      this.decryptStates$.next(new Map(this.decryptStates));
      this.updatePendingCount();

      // Emit decrypt event
      this.decryptEvent$.next({
        giftWrapId,
        status: "error",
        error,
      });

      return null;
    }
  }

  /** Decrypt all pending gift wraps */
  async decryptAll(): Promise<{ success: number; error: number }> {
    if (!this.signer) {
      throw new Error("No signer available");
    }

    let success = 0;
    let error = 0;

    const pending = this.giftWraps.filter(
      (gw) =>
        !isGiftWrapUnlocked(gw) &&
        this.decryptStates.get(gw.id)?.status !== "decrypting",
    );

    for (const gw of pending) {
      try {
        const rumor = await this.decrypt(gw.id);
        if (rumor) {
          success++;
        } else {
          error++;
        }
      } catch {
        error++;
      }
    }

    return { success, error };
  }

  /**
   * Reload persisted encrypted content IDs from Dexie
   * Useful after sending messages to ensure newly persisted content is recognized
   */
  async refreshPersistedIds(): Promise<void> {
    this.persistedIds = await getStoredEncryptedContentIds();
    console.log(
      `[GiftWrap] Refreshed persisted IDs: ${this.persistedIds.size} cached`,
    );
  }

  /** Auto-decrypt pending gift wraps (called when auto-decrypt is enabled) */
  private async autoDecryptPending() {
    if (!this.signer || !this.settings$.value.autoDecrypt) return;

    const pending = this.giftWraps.filter((gw) => {
      const state = this.decryptStates.get(gw.id);
      return state?.status === "pending";
    });

    for (const gw of pending) {
      try {
        await this.decrypt(gw.id);
      } catch {
        // Errors are already tracked in decryptStates
      }
    }
  }

  /** Get counts by status */
  getCounts(): {
    pending: number;
    success: number;
    error: number;
    total: number;
  } {
    let pending = 0;
    let success = 0;
    let error = 0;

    for (const state of this.decryptStates.values()) {
      switch (state.status) {
        case "pending":
        case "decrypting":
          pending++;
          break;
        case "success":
          success++;
          break;
        case "error":
          error++;
          break;
      }
    }

    return { pending, success, error, total: this.giftWraps.length };
  }

  /** Update signer (when user logs in/out or changes) */
  setSigner(signer: ISigner | null) {
    this.signer = signer;

    // Auto-decrypt if enabled and signer is available
    if (signer && this.settings$.value.autoDecrypt) {
      this.autoDecryptPending();
    }
  }

  /** Cleanup subscriptions */
  cleanup() {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions = [];
    if (this.relaySubscription) {
      this.relaySubscription.unsubscribe();
      this.relaySubscription = null;
    }
  }

  /** Full destroy (call when app unmounts) */
  destroy() {
    this.cleanup();
    if (this.persistenceCleanup) {
      this.persistenceCleanup();
      this.persistenceCleanup = null;
    }
  }
}

// Singleton instance
const giftWrapService = new GiftWrapService();

export default giftWrapService;
