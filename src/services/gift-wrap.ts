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
  /** Current user's pubkey */
  private userPubkey: string | null = null;
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

  constructor() {
    // Start encrypted content persistence
    this.persistenceCleanup = persistEncryptedContent(
      eventStore,
      encryptedContentStorage,
    );
  }

  /** Initialize the service with user pubkey and signer */
  async init(pubkey: string, signer: ISigner | null) {
    this.cleanup();
    this.userPubkey = pubkey;
    this.signer = signer;
    this.decryptStates.clear();
    this.decryptStates$.next(new Map());
    this.pendingCount$.next(0);

    // Load persisted encrypted content IDs to know which gift wraps are already decrypted
    this.persistedIds = await getStoredEncryptedContentIds();

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

    // If enabled, load stored gift wraps and start syncing
    if (this.settings$.value.enabled) {
      await this.loadStoredGiftWraps();
      this.startSync();
    }
  }

  /** Load stored gift wraps from Dexie into EventStore */
  private async loadStoredGiftWraps() {
    if (!this.userPubkey) return;

    try {
      const storedEvents = await loadStoredGiftWraps(this.userPubkey);
      if (storedEvents.length > 0) {
        console.log(
          `[GiftWrap] Loading ${storedEvents.length} stored gift wraps into EventStore`,
        );
        // Add stored events to EventStore - this triggers the timeline subscription
        for (const event of storedEvents) {
          eventStore.add(event);
        }
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
          // Extract relay URLs from tags
          return event.tags
            .filter((tag) => tag[0] === "relay")
            .map((tag) => tag[1])
            .filter(Boolean);
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

      console.log(
        `[GiftWrap] Fetching inbox relay list from ${relaysToQuery.length} relays`,
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
            console.warn(`[GiftWrap] Error fetching inbox relay list:`, err);
          },
        });
    } catch (err) {
      console.warn(`[GiftWrap] Error in fetchInboxRelayList:`, err);
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

    console.log(
      `[GiftWrap] Starting sync with ${relaysToUse.length} relays (inbox: ${inboxRelays.length})`,
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

  /** Subscribe to gift wraps for current user */
  private subscribeToGiftWraps(relays: string[]) {
    if (!this.userPubkey) return;

    // Subscribe to gift wraps addressed to this user
    const reqFilter = {
      kinds: [kinds.GiftWrap],
      "#p": [this.userPubkey],
    };

    // Use timeline observable for reactive updates
    const sub = eventStore
      .timeline(reqFilter)
      .pipe(map((events) => events.sort((a, b) => b.created_at - a.created_at)))
      .subscribe((giftWraps) => {
        // Find new gift wraps that we haven't seen before
        const newGiftWraps = giftWraps.filter(
          (gw) => !this.giftWraps.some((existing) => existing.id === gw.id),
        );

        this.giftWraps = giftWraps;
        this.giftWraps$.next(giftWraps);

        // Update decrypt states for new gift wraps
        for (const gw of giftWraps) {
          if (!this.decryptStates.has(gw.id)) {
            // Check both in-memory unlock state and persisted IDs
            // Persisted IDs indicate content was decrypted in a previous session
            const isUnlocked =
              isGiftWrapUnlocked(gw) || this.persistedIds.has(gw.id);
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

    // Request gift wraps from relays (always have relays - inbox or aggregator fallback)
    console.log(
      `[GiftWrap] Requesting gift wraps from ${relays.length} relays`,
    );
    pool.request(relays, [reqFilter], { eventStore }).subscribe({
      next: () => {
        // Events are automatically added to eventStore via the options
      },
      error: (err) => {
        console.warn(`[GiftWrap] Error fetching from relays:`, err);
      },
    });
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
    const conversationMap = new Map<string, Conversation>();
    const allRumors: Array<{ giftWrap: NostrEvent; rumor: Rumor }> = [];

    for (const gw of this.giftWraps) {
      if (!isGiftWrapUnlocked(gw)) continue;

      const rumor = getGiftWrapRumor(gw);
      if (!rumor) continue;

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
        await this.decrypt(gw.id);
        success++;
      } catch {
        error++;
      }
    }

    return { success, error };
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
