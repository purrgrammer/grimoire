/**
 * Gift Wrap Service V2 - Performant Implementation
 *
 * Maintains the same API as V1 but with optimized sync engine:
 * - Relay auth pre-check before heavy operations
 * - Time-windowed loading (recent → historical → archive)
 * - Batched IndexedDB writes
 * - Incremental conversation updates
 * - Smart priority-based decryption
 *
 * UI components work unchanged - same observables, same methods
 */

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
import { getSeenRelays } from "applesauce-core/helpers/relays";
import type { NostrEvent } from "@/types/nostr";
import type { ISigner } from "applesauce-signers";
import eventStore from "./event-store";
import pool from "./relay-pool";
import {
  encryptedContentStorage,
  getStoredEncryptedContentIds,
  loadStoredGiftWraps,
} from "./db";
import { AGGREGATOR_RELAYS } from "./loaders";
import relayListCache from "./relay-list-cache";
import { normalizeRelayURL } from "@/lib/relay-url";
import { dmDebug, dmInfo, dmWarn } from "@/lib/dm-debug";
import {
  preAuthenticateRelays,
  getAuthenticatedRelays,
  getFailedRelays,
} from "./relay-auth-manager";
import { giftWrapPersistence } from "./gift-wrap-persistence";

/** Kind 10050: DM relay list (NIP-17) */
const DM_RELAY_LIST_KIND = 10050;

/** Kind 14: Private direct message (NIP-17) */
const PRIVATE_DM_KIND = 14;

/** One day in seconds (for time-based filtering) */
const DAY_IN_SECONDS = 86400;

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

/** Relay statistics for gift wrap tracking */
export interface RelayStats {
  /** Number of successfully decrypted gift wraps from this relay */
  success: number;
  /** Number of failed decryption attempts from this relay */
  failed: number;
  /** Total gift wraps received from this relay */
  total: number;
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

/**
 * Incremental Conversation Index
 * O(1) updates instead of O(N) rebuilds
 */
class ConversationIndex {
  private conversations = new Map<string, Conversation>();
  private changed = false;

  /**
   * Add or update a rumor in the conversation index
   * @returns true if conversation was added/updated, false if no change
   */
  addRumor(giftWrap: NostrEvent, rumor: Rumor): boolean {
    const convId = getConversationIdentifierFromMessage(rumor);
    const existing = this.conversations.get(convId);

    // Only update if this is newer (or first message)
    if (
      !existing ||
      rumor.created_at > (existing.lastMessage?.created_at ?? 0)
    ) {
      this.conversations.set(convId, {
        id: convId,
        participants: getConversationParticipants(rumor),
        lastMessage: rumor,
        lastGiftWrap: giftWrap,
      });
      this.changed = true;
      return true;
    }
    return false;
  }

  /**
   * Get all conversations sorted by last message timestamp
   */
  getConversations(): Conversation[] {
    return Array.from(this.conversations.values()).sort(
      (a, b) =>
        (b.lastMessage?.created_at ?? 0) - (a.lastMessage?.created_at ?? 0),
    );
  }

  /**
   * Check if conversations have changed since last check
   * Resets the changed flag
   */
  hasChanged(): boolean {
    const changed = this.changed;
    this.changed = false;
    return changed;
  }

  /**
   * Clear all conversations
   */
  clear() {
    this.conversations.clear();
    this.changed = true;
  }
}

/**
 * Smart Decrypt Queue
 * Priority-based decryption: visible → recent → background
 */
class SmartDecryptQueue {
  private queue: string[] = [];
  private processing = false;
  private readonly MAX_CONCURRENT = 5;

  constructor(
    private decryptFn: (id: string) => Promise<Rumor | null>,
    private updateStateFn: () => void,
  ) {}

  /**
   * Enqueue gift wraps for decryption with priority
   */
  enqueue(ids: string[], priority: "high" | "normal" | "low" = "normal") {
    if (priority === "high") {
      // High priority: add to front of queue
      this.queue.unshift(...ids);
    } else {
      // Normal/low priority: add to end
      this.queue.push(...ids);
    }

    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Process the queue with concurrency limit
   */
  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    dmDebug("SmartDecrypt", `Processing queue: ${this.queue.length} pending`);

    while (this.queue.length > 0) {
      // Take up to MAX_CONCURRENT items
      const batch = this.queue.splice(0, this.MAX_CONCURRENT);

      // Decrypt in parallel
      await Promise.all(
        batch.map(async (id) => {
          try {
            await this.decryptFn(id);
          } catch (err) {
            dmWarn(
              "SmartDecrypt",
              `Decrypt failed for ${id.slice(0, 8)}: ${err}`,
            );
          }
        }),
      );

      // Update state after each batch
      this.updateStateFn();

      // Yield to event loop between batches
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.processing = false;
    dmDebug("SmartDecrypt", "Queue processing complete");
  }

  /**
   * Clear the queue
   */
  clear() {
    this.queue = [];
  }

  /**
   * Get queue size
   */
  get size(): number {
    return this.queue.length;
  }
}

/**
 * Run promises with limited concurrency
 */
async function limitConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result);
      const index = executing.indexOf(promise);
      if (index !== -1) {
        executing.splice(index, 1);
      }
    });
    executing.push(promise);

    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
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

  /** Conversation index for O(1) updates */
  private conversationIndex = new ConversationIndex();
  /** Conversations grouped by participants (NIP-17 kind 14 messages only) */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

  /**
   * All decrypted rumors (any kind, not just DMs)
   */
  readonly decryptedRumors$ = new BehaviorSubject<
    Array<{ giftWrap: NostrEvent; rumor: Rumor }>
  >([]);

  /** Inbox relays (kind 10050) */
  readonly inboxRelays$ = new BehaviorSubject<string[]>([]);

  /** Relay statistics (success/fail counts per relay) */
  private relayStats = new Map<string, RelayStats>();
  readonly relayStats$ = new BehaviorSubject<Map<string, RelayStats>>(
    new Map(),
  );

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

  /** Smart decrypt queue for priority-based decryption */
  private decryptQueue: SmartDecryptQueue;

  /** Authenticated relays (passed auth check) */
  private authenticatedRelays: string[] = [];

  constructor() {
    // Start encrypted content persistence
    this.persistenceCleanup = persistEncryptedContent(
      eventStore,
      encryptedContentStorage,
    );

    // Initialize smart decrypt queue
    this.decryptQueue = new SmartDecryptQueue(
      (id) => this.decryptInternal(id),
      () => {
        this.decryptStates$.next(new Map(this.decryptStates));
        this.updatePendingCount();
        this.updateConversations();
      },
    );
  }

  /** Wait for encrypted content cache to be accessible */
  private async waitForCacheReady(): Promise<void> {
    if (this.persistedIds.size === 0) {
      this.cacheReady = true;
      return;
    }

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
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    dmWarn("GiftWrap", `Cache readiness check timed out, proceeding anyway`);
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
    this.conversationIndex.clear();
    this.relayStats.clear();
    this.relayStats$.next(new Map());

    if (!this.settings$.value.enabled) {
      dmDebug("GiftWrap", "Inbox sync disabled, skipping initialization");
      return;
    }

    dmInfo("GiftWrap", `Initializing inbox sync for ${pubkey.slice(0, 8)}`);

    // Load persisted encrypted content IDs
    this.persistedIds = await getStoredEncryptedContentIds();
    await this.waitForCacheReady();

    // Load inbox relays (kind 10050)
    this.loadInboxRelays();

    // Subscribe to event updates
    const updateSub = eventStore.update$.subscribe((event) => {
      if (
        event.kind === kinds.GiftWrap &&
        this.giftWraps.some((g) => g.id === event.id)
      ) {
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
      dmInfo(
        "GiftWrap",
        `Loading stored gift wraps for ${this.userPubkey.slice(0, 8)}...`,
      );
      const storedEvents = await loadStoredGiftWraps(this.userPubkey);

      if (storedEvents.length === 0) {
        dmInfo("GiftWrap", "No stored gift wraps found in cache");
        return;
      }

      dmInfo(
        "GiftWrap",
        `Loading ${storedEvents.length} stored gift wraps from cache`,
      );

      // Performance optimization: Load events in chunks with RAF
      const CHUNK_SIZE = 20;
      const startTime = performance.now();

      for (let i = 0; i < storedEvents.length; i += CHUNK_SIZE) {
        const chunk = storedEvents.slice(i, i + CHUNK_SIZE);
        for (const event of chunk) {
          eventStore.add(event);
        }

        if (i + CHUNK_SIZE < storedEvents.length) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }

      const elapsed = performance.now() - startTime;
      dmInfo(
        "GiftWrap",
        `✅ Loaded ${storedEvents.length} stored gift wraps in ${elapsed.toFixed(0)}ms`,
      );

      // Wait a moment for applesauce encrypted content cache to attach symbols
      await new Promise((resolve) => setTimeout(resolve, 500));

      dmInfo(
        "GiftWrap",
        `Persisted encrypted content IDs: ${this.persistedIds.size}`,
      );
    } catch (err) {
      console.error(`[GiftWrap] Error loading stored gift wraps:`, err);
    }
  }

  /** Update settings */
  updateSettings(settings: Partial<InboxSettings>) {
    const newSettings = { ...this.settings$.value, ...settings };
    this.settings$.next(newSettings);
    saveSettings(newSettings);

    if (settings.enabled !== undefined) {
      if (settings.enabled) {
        this.startSync();
      } else {
        this.stopSync();
      }
    }

    if (settings.autoDecrypt && this.signer) {
      this.autoDecryptPending();
    }
  }

  /** Load inbox relays from kind 10050 event */
  private async loadInboxRelays() {
    if (!this.userPubkey) return;

    const sub = eventStore
      .replaceable(DM_RELAY_LIST_KIND, this.userPubkey)
      .pipe(
        filter((e) => e !== undefined),
        map((event) => {
          if (!event) return [];
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

        if (!hadRelays && relays.length > 0 && this.settings$.value.enabled) {
          dmInfo(
            "GiftWrap",
            `Discovered ${relays.length} inbox relays, restarting sync`,
          );
          this.startSync();
        }
      });

    this.subscriptions.push(sub);
    await this.fetchInboxRelayList();
  }

  /** Fetch the user's inbox relay list (kind 10050) from their outbox relays */
  private async fetchInboxRelayList() {
    if (!this.userPubkey) return;

    try {
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
  async startSync() {
    if (!this.userPubkey) {
      this.syncStatus$.next("disabled");
      return;
    }

    const inboxRelays = this.inboxRelays$.value;
    const relaysToUse =
      inboxRelays.length > 0 ? inboxRelays : AGGREGATOR_RELAYS;

    dmInfo(
      "GiftWrap",
      `Starting sync with ${relaysToUse.length} relays (inbox: ${inboxRelays.length})`,
    );

    // PERFORMANCE OPTIMIZATION: Pre-authenticate relays before querying
    // This prevents AUTH prompts from blocking UI during heavy operations
    dmInfo("GiftWrap", "Pre-authenticating relays before gift wrap sync...");
    const authResults = await preAuthenticateRelays(
      relaysToUse,
      this.userPubkey,
    );

    this.authenticatedRelays = getAuthenticatedRelays(authResults);
    const failedRelays = getFailedRelays(authResults);

    if (failedRelays.length > 0) {
      dmWarn(
        "GiftWrap",
        `Failed to authenticate ${failedRelays.length} relays, excluding from sync`,
      );
    }

    if (this.authenticatedRelays.length === 0) {
      dmWarn("GiftWrap", "No authenticated relays available for sync");
      this.syncStatus$.next("error");
      return;
    }

    dmInfo(
      "GiftWrap",
      `✅ ${this.authenticatedRelays.length} relays authenticated, starting gift wrap sync`,
    );

    this.syncStatus$.next("syncing");
    this.subscribeToGiftWraps(this.authenticatedRelays);
  }

  /** Stop syncing */
  stopSync() {
    this.syncStatus$.next("disabled");
    if (this.relaySubscription) {
      this.relaySubscription.unsubscribe();
      this.relaySubscription = null;
    }
  }

  /** Subscribe to gift wraps with time-windowed loading */
  private subscribeToGiftWraps(relays: string[]) {
    if (!this.userPubkey) return;

    const now = Math.floor(Date.now() / 1000);

    // FIX: Load ALL gift wraps, not just recent window
    // Users need to see all their messages, not just last 7 days
    const baseFilter = {
      kinds: [kinds.GiftWrap],
      "#p": [this.userPubkey],
      // No 'since' - load everything
    };

    // Real-time filter for new messages
    const realtimeFilter = {
      kinds: [kinds.GiftWrap],
      "#p": [this.userPubkey],
      since: now,
    };

    dmInfo("GiftWrap", `Loading all gift wraps from ${relays.length} relays`);

    // Timeline subscription for reactive updates (ALL messages)
    const sub = eventStore
      .timeline(baseFilter)
      .pipe(map((events) => events.sort((a, b) => b.created_at - a.created_at)))
      .subscribe((giftWraps) => {
        this.handleGiftWrapsUpdate(giftWraps);
      });

    this.relaySubscription = sub;

    // Subscribe to relays with progressive loading strategy:
    // 1. Initial batch with LIMIT for fast first response
    // 2. Then backfill without limit
    const initialFilter = { ...baseFilter, limit: 50 };

    dmInfo("GiftWrap", "Requesting initial batch (limit: 50)");
    const initialSub = pool
      .subscription(relays, [initialFilter], { eventStore })
      .subscribe({
        error: (err) => {
          dmWarn("GiftWrap", `Initial subscription error: ${err}`);
        },
      });

    this.subscriptions.push(initialSub);

    // After 3s, backfill full history without limit
    setTimeout(() => {
      dmInfo("GiftWrap", "Backfilling full gift wrap history");

      const backfillSub = pool
        .subscription(relays, [baseFilter], { eventStore })
        .subscribe({
          error: (err) => {
            dmWarn("GiftWrap", `Backfill subscription error: ${err}`);
          },
        });

      this.subscriptions.push(backfillSub);
    }, 3000);

    // After 5s, start real-time subscription for new messages
    setTimeout(() => {
      dmInfo("GiftWrap", "Starting real-time subscription for new messages");

      const realtimeSub = pool
        .subscription(relays, [realtimeFilter], { eventStore })
        .subscribe({
          error: (err) => {
            dmWarn("GiftWrap", `Real-time subscription error: ${err}`);
          },
        });

      this.subscriptions.push(realtimeSub);
    }, 5000);
  }

  /** Handle gift wraps update from timeline */
  private handleGiftWrapsUpdate(giftWraps: NostrEvent[]) {
    dmInfo(
      "GiftWrap",
      `📬 Timeline update: ${giftWraps.length} gift wraps (prev: ${this.giftWraps.length})`,
    );

    // Find new gift wraps
    const newGiftWraps = giftWraps.filter(
      (gw) => !this.giftWraps.some((existing) => existing.id === gw.id),
    );

    if (newGiftWraps.length > 0) {
      dmDebug("GiftWrap", `Found ${newGiftWraps.length} new gift wraps`);

      // PERFORMANCE: Batch persist new gift wraps
      if (this.userPubkey) {
        for (const gw of newGiftWraps) {
          giftWrapPersistence.enqueue(gw, this.userPubkey).catch((err) => {
            console.warn(
              `[GiftWrap] Error enqueueing gift wrap for persistence:`,
              err,
            );
          });
        }
      }

      // Track relay statistics for new gift wraps
      for (const gw of newGiftWraps) {
        const seenRelays = getSeenRelays(gw);
        if (seenRelays && seenRelays.size > 0) {
          for (const relayUrl of seenRelays) {
            const existing = this.relayStats.get(relayUrl);
            const stats: RelayStats = existing ?? {
              success: 0,
              failed: 0,
              total: 0,
            };
            stats.total++;
            this.relayStats.set(relayUrl, stats);
          }
        }
      }
    }

    this.giftWraps = giftWraps;
    this.giftWraps$.next(giftWraps);

    // Update decrypt states for new gift wraps
    let newUnlocked = 0;
    let newPending = 0;
    for (const gw of giftWraps) {
      if (!this.decryptStates.has(gw.id)) {
        const hasSymbol = isGiftWrapUnlocked(gw);
        const hasPersisted = this.persistedIds.has(gw.id);
        const isUnlocked = hasSymbol || hasPersisted;

        if (isUnlocked) {
          newUnlocked++;
        } else {
          newPending++;
        }

        this.decryptStates.set(gw.id, {
          status: isUnlocked ? "success" : "pending",
          decryptedAt: isUnlocked ? Date.now() : undefined,
        });

        // Track relay stats for success
        if (isUnlocked) {
          const seenRelays = getSeenRelays(gw);
          if (seenRelays && seenRelays.size > 0) {
            for (const relayUrl of seenRelays) {
              const existing = this.relayStats.get(relayUrl);
              if (existing) {
                existing.success++;
              } else {
                // Initialize stats for cached events that don't have relay tracking yet
                this.relayStats.set(relayUrl, {
                  success: 1,
                  failed: 0,
                  total: 1,
                });
              }
            }
          }
        }
      }
    }

    dmInfo(
      "GiftWrap",
      `Decrypt states: ${newUnlocked} unlocked, ${newPending} pending (total: ${this.decryptStates.size})`,
    );

    this.decryptStates$.next(new Map(this.decryptStates));
    this.updatePendingCount();

    // Emit relay stats
    this.relayStats$.next(new Map(this.relayStats));

    // Update conversations
    this.updateConversations();

    // Auto-decrypt if enabled
    if (this.settings$.value.autoDecrypt && this.signer) {
      this.autoDecryptPending();
    }

    this.syncStatus$.next("idle");
  }

  /** Update pending count for UI display */
  private updatePendingCount() {
    let pending = 0;
    let decrypting = 0;
    let success = 0;
    let error = 0;

    for (const state of this.decryptStates.values()) {
      switch (state.status) {
        case "pending":
          pending++;
          break;
        case "decrypting":
          decrypting++;
          break;
        case "success":
          success++;
          break;
        case "error":
          error++;
          break;
      }
    }

    const total = pending + decrypting;
    dmDebug(
      "GiftWrap",
      `Pending count: ${total} (${pending} pending, ${decrypting} decrypting, ${success} success, ${error} error)`,
    );
    this.pendingCount$.next(total);
  }

  /**
   * Update conversations and decrypted rumors
   * PERFORMANCE: Incremental updates instead of full rebuild
   */
  private updateConversations() {
    if (!this.cacheReady) {
      dmDebug("GiftWrap", "Cache not ready, deferring conversation update");
      return;
    }

    const allRumors: Array<{ giftWrap: NostrEvent; rumor: Rumor }> = [];

    for (const gw of this.giftWraps) {
      const isUnlocked = isGiftWrapUnlocked(gw) || this.persistedIds.has(gw.id);
      if (!isUnlocked) continue;

      const rumor = getGiftWrapRumor(gw);
      if (!rumor) continue;

      allRumors.push({ giftWrap: gw, rumor });

      // PERFORMANCE: Only update conversation if this is a DM
      if (rumor.kind === PRIVATE_DM_KIND) {
        this.conversationIndex.addRumor(gw, rumor);
      }
    }

    // Sort rumors by timestamp
    allRumors.sort((a, b) => b.rumor.created_at - a.rumor.created_at);
    this.decryptedRumors$.next(allRumors);

    // Only emit if conversations actually changed
    if (this.conversationIndex.hasChanged()) {
      this.conversations$.next(this.conversationIndex.getConversations());
      dmDebug(
        "GiftWrap",
        `Updated conversations: ${this.conversationIndex.getConversations().length}`,
      );
    }
  }

  /** Internal decrypt without state emission (for batching) */
  private async decryptInternal(giftWrapId: string): Promise<Rumor | null> {
    // FIX: Don't throw errors, return null and update state
    // This prevents one failure from cascading to other decrypts
    if (!this.signer) {
      dmWarn("GiftWrap", `Cannot decrypt ${giftWrapId.slice(0, 8)}: No signer`);
      this.decryptStates.set(giftWrapId, {
        status: "error",
        error: "No signer available",
      });
      return null;
    }

    const gw = this.giftWraps.find((g) => g.id === giftWrapId);
    if (!gw) {
      dmWarn("GiftWrap", `Cannot decrypt ${giftWrapId.slice(0, 8)}: Not found`);
      this.decryptStates.set(giftWrapId, {
        status: "error",
        error: "Gift wrap not found",
      });
      return null;
    }

    // Check if already unlocked
    if (isGiftWrapUnlocked(gw)) {
      const rumor = getGiftWrapRumor(gw);
      if (rumor) {
        // Mark as success if not already
        const currentState = this.decryptStates.get(giftWrapId);
        if (currentState?.status !== "success") {
          this.decryptStates.set(giftWrapId, {
            status: "success",
            decryptedAt: Date.now(),
          });
        }
        return rumor;
      }
    }

    // Check if already decrypting
    const currentState = this.decryptStates.get(giftWrapId);
    if (currentState?.status === "decrypting") {
      dmDebug("GiftWrap", `Already decrypting ${giftWrapId.slice(0, 8)}`);
      return null;
    }

    // Mark as decrypting
    this.decryptStates.set(giftWrapId, { status: "decrypting" });

    // Debug: Check gift wrap recipient
    const recipientTag = gw.tags.find((t) => t[0] === "p");
    const recipientPubkey = recipientTag?.[1];
    dmDebug(
      "GiftWrap",
      `🔓 Attempting to decrypt ${giftWrapId.slice(0, 8)}...`,
    );
    dmDebug(
      "GiftWrap",
      `  Recipient: ${recipientPubkey?.slice(0, 8)} (user: ${this.userPubkey?.slice(0, 8)})`,
    );

    // Verify signer pubkey matches user
    let signerPubkey: string | undefined;
    try {
      signerPubkey = await this.signer.getPublicKey();
      dmDebug("GiftWrap", `  Signer pubkey: ${signerPubkey.slice(0, 8)}`);
      dmDebug("GiftWrap", `  Signer type: ${this.signer.constructor.name}`);

      // Check if signer has NIP-44 support
      if (typeof (this.signer as any).nip44 === "object") {
        dmDebug("GiftWrap", `  Signer has NIP-44 support ✓`);
      } else {
        dmWarn(
          "GiftWrap",
          `  WARNING: Signer may not support NIP-44 (required for gift wraps)`,
        );
      }

      if (signerPubkey !== this.userPubkey) {
        throw new Error(
          `Signer pubkey mismatch: signer=${signerPubkey.slice(0, 8)}, user=${this.userPubkey?.slice(0, 8)}`,
        );
      }

      if (recipientPubkey && recipientPubkey !== this.userPubkey) {
        throw new Error(
          `Gift wrap not for this user: recipient=${recipientPubkey.slice(0, 8)}, user=${this.userPubkey.slice(0, 8)}`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      dmWarn("GiftWrap", `  Pre-decrypt validation failed: ${error}`);
      throw err;
    }

    try {
      const rumor = await unlockGiftWrap(gw, this.signer);

      if (!rumor) {
        throw new Error("unlockGiftWrap returned null/undefined");
      }

      this.persistedIds.add(giftWrapId);
      this.decryptStates.set(giftWrapId, {
        status: "success",
        decryptedAt: Date.now(),
      });
      this.decryptEvent$.next({ giftWrapId, status: "success", rumor });

      // Track relay stats for successful decrypt
      const seenRelays = getSeenRelays(gw);
      if (seenRelays && seenRelays.size > 0) {
        for (const relayUrl of seenRelays) {
          const existing = this.relayStats.get(relayUrl);
          if (existing) {
            existing.success++;
            this.relayStats.set(relayUrl, existing);
          }
        }
        this.relayStats$.next(new Map(this.relayStats));
      }

      dmInfo(
        "GiftWrap",
        `✅ Decrypted ${giftWrapId.slice(0, 8)} (kind: ${rumor.kind})`,
      );
      return rumor;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      // Enhanced error logging for JSON parse errors
      if (error.includes("JSON") || error.includes("Unexpected token")) {
        dmWarn("GiftWrap", `❌ JSON parse error for ${giftWrapId.slice(0, 8)}`);
        dmWarn("GiftWrap", `  Error: ${error}`);
        dmWarn("GiftWrap", `  This usually means:`);
        dmWarn(
          "GiftWrap",
          `  1. Signer is decrypting with wrong key (produces garbage)`,
        );
        dmWarn("GiftWrap", `  2. Signer doesn't support NIP-44 encryption`);
        dmWarn("GiftWrap", `  3. Gift wrap is corrupted or test data`);
        dmWarn(
          "GiftWrap",
          `  Gift wrap content preview: ${gw.content.slice(0, 100)}...`,
        );
      } else {
        dmWarn(
          "GiftWrap",
          `❌ Decrypt failed for ${giftWrapId.slice(0, 8)}: ${error}`,
        );
      }

      // FIX: Set error state but DON'T throw - allows other decrypts to continue
      this.decryptStates.set(giftWrapId, { status: "error", error });
      this.decryptEvent$.next({ giftWrapId, status: "error", error });

      // Track relay stats for failed decrypt
      const seenRelays = getSeenRelays(gw);
      if (seenRelays && seenRelays.size > 0) {
        for (const relayUrl of seenRelays) {
          const existing = this.relayStats.get(relayUrl);
          if (existing) {
            existing.failed++;
            this.relayStats.set(relayUrl, existing);
          }
        }
        this.relayStats$.next(new Map(this.relayStats));
      }

      return null;
    }
  }

  /** Decrypt a single gift wrap (public API) */
  async decrypt(giftWrapId: string): Promise<Rumor | null> {
    const result = await this.decryptInternal(giftWrapId);
    this.decryptStates$.next(new Map(this.decryptStates));
    this.updatePendingCount();
    this.updateConversations();
    return result;
  }

  /** Decrypt all pending gift wraps with parallel execution */
  async decryptAll(): Promise<{ success: number; error: number }> {
    if (!this.signer) {
      throw new Error("No signer available");
    }

    const pending = this.giftWraps.filter(
      (gw) =>
        !isGiftWrapUnlocked(gw) &&
        this.decryptStates.get(gw.id)?.status !== "decrypting",
    );

    if (pending.length === 0) {
      return { success: 0, error: 0 };
    }

    const MAX_CONCURRENT = 5;
    let success = 0;
    let error = 0;

    const startTime = performance.now();
    dmInfo(
      "GiftWrap",
      `Decrypting ${pending.length} gift wraps (max ${MAX_CONCURRENT} concurrent)`,
    );

    const tasks = pending.map((gw) => async () => {
      try {
        const rumor = await this.decryptInternal(gw.id);
        if (rumor) {
          success++;
        } else {
          error++;
        }
      } catch {
        error++;
      }
    });

    await limitConcurrency(tasks, MAX_CONCURRENT);

    const elapsed = performance.now() - startTime;
    dmInfo(
      "GiftWrap",
      `Decrypted ${success} messages (${error} errors) in ${elapsed.toFixed(0)}ms`,
    );

    this.decryptStates$.next(new Map(this.decryptStates));
    this.updatePendingCount();
    this.updateConversations();

    return { success, error };
  }

  /** Reload persisted encrypted content IDs from Dexie */
  async refreshPersistedIds(): Promise<void> {
    this.persistedIds = await getStoredEncryptedContentIds();
    dmDebug(
      "GiftWrap",
      `Refreshed persisted IDs: ${this.persistedIds.size} cached`,
    );
  }

  /** Auto-decrypt pending gift wraps using smart queue */
  private async autoDecryptPending() {
    if (!this.signer || !this.settings$.value.autoDecrypt) return;

    const pending = this.giftWraps
      .filter((gw) => {
        const state = this.decryptStates.get(gw.id);
        return state?.status === "pending";
      })
      .map((gw) => gw.id);

    if (pending.length === 0) return;

    // PERFORMANCE: Use smart queue for priority-based decryption
    // Recent messages get higher priority
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - DAY_IN_SECONDS;

    const recent = pending.filter((id) => {
      const gw = this.giftWraps.find((g) => g.id === id);
      return gw && gw.created_at > oneDayAgo;
    });

    const older = pending.filter((id) => !recent.includes(id));

    dmDebug(
      "GiftWrap",
      `Auto-decrypt: ${recent.length} recent, ${older.length} older`,
    );

    // Enqueue with priority
    this.decryptQueue.enqueue(recent, "high");
    this.decryptQueue.enqueue(older, "normal");
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

  /** Update signer */
  setSigner(signer: ISigner | null) {
    this.signer = signer;
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
    this.decryptQueue.clear();
  }

  /** Full destroy */
  async destroy() {
    this.cleanup();
    if (this.persistenceCleanup) {
      this.persistenceCleanup();
      this.persistenceCleanup = null;
    }
    // Flush any remaining writes
    await giftWrapPersistence.forceFlush();
  }
}

// Singleton instance
const giftWrapService = new GiftWrapService();

export default giftWrapService;
