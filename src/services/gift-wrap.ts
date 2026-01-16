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
import { encryptedContentStorage } from "./db";

/** Kind 10050: DM relay list (NIP-17) */
const DM_RELAY_LIST_KIND = 10050;

/** Kind 14: Private direct message (NIP-17) */
const PRIVATE_DM_KIND = 14;

/** Rumor is an unsigned event - used for gift wrap contents */
interface Rumor {
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

  /** Conversations grouped by participants */
  readonly conversations$ = new BehaviorSubject<Conversation[]>([]);

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

  private subscriptions: Subscription[] = [];
  private relaySubscription: Subscription | null = null;
  private persistenceCleanup: (() => void) | null = null;

  constructor() {
    // Start encrypted content persistence
    this.persistenceCleanup = persistEncryptedContent(
      eventStore,
      encryptedContentStorage,
    );
  }

  /** Initialize the service with user pubkey and signer */
  init(pubkey: string, signer: ISigner | null) {
    this.cleanup();
    this.userPubkey = pubkey;
    this.signer = signer;
    this.decryptStates.clear();
    this.decryptStates$.next(new Map());

    // Load inbox relays (kind 10050)
    this.loadInboxRelays();

    // If enabled, start syncing
    if (this.settings$.value.enabled) {
      this.startSync();
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
        this.inboxRelays$.next(relays);
      });

    this.subscriptions.push(sub);
  }

  /** Start syncing gift wraps from inbox relays */
  startSync() {
    if (!this.userPubkey) {
      this.syncStatus$.next("disabled");
      return;
    }

    const relays = this.inboxRelays$.value;
    if (relays.length === 0) {
      // Use default relays if no inbox relays set
      this.syncStatus$.next("syncing");
      this.subscribeToGiftWraps([]);
    } else {
      this.syncStatus$.next("syncing");
      this.subscribeToGiftWraps(relays);
    }
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
        this.giftWraps = giftWraps;
        this.giftWraps$.next(giftWraps);

        // Update decrypt states for new gift wraps
        for (const gw of giftWraps) {
          if (!this.decryptStates.has(gw.id)) {
            const isUnlocked = isGiftWrapUnlocked(gw);
            this.decryptStates.set(gw.id, {
              status: isUnlocked ? "success" : "pending",
              decryptedAt: isUnlocked ? Date.now() : undefined,
            });
          }
        }
        this.decryptStates$.next(new Map(this.decryptStates));

        // Update conversations
        this.updateConversations();

        // Auto-decrypt if enabled
        if (this.settings$.value.autoDecrypt && this.signer) {
          this.autoDecryptPending();
        }

        this.syncStatus$.next("idle");
      });

    this.relaySubscription = sub;

    // Also request from relays
    if (relays.length > 0) {
      pool.request(relays, [reqFilter], { eventStore }).subscribe({
        next: () => {
          // Events are automatically added to eventStore via the options
        },
        error: (err) => {
          console.warn(`[GiftWrap] Error fetching from relays:`, err);
        },
      });
    }
  }

  /** Update conversations from decrypted gift wraps */
  private updateConversations() {
    const conversationMap = new Map<string, Conversation>();

    for (const gw of this.giftWraps) {
      if (!isGiftWrapUnlocked(gw)) continue;

      const rumor = getGiftWrapRumor(gw);
      if (!rumor || rumor.kind !== PRIVATE_DM_KIND) continue;

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

    try {
      const rumor = await unlockGiftWrap(gw, this.signer);

      // Update state to success
      this.decryptStates.set(giftWrapId, {
        status: "success",
        decryptedAt: Date.now(),
      });
      this.decryptStates$.next(new Map(this.decryptStates));

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
