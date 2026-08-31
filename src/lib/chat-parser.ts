import type {
  ChatCommandResult,
  DMIdentifier,
  GroupListIdentifier,
} from "@/types/chat";
import { Nip10Adapter } from "./chat/adapters/nip-10-adapter";
import { Nip29Adapter } from "./chat/adapters/nip-29-adapter";
import { Nip53Adapter } from "./chat/adapters/nip-53-adapter";
import { Nip22Adapter } from "./chat/adapters/nip-22-adapter";
import { nip19 } from "nostr-tools";
import { firstValueFrom } from "rxjs";
import { toArray, catchError } from "rxjs/operators";
import { timeout as rxTimeout, of } from "rxjs";
import { getOutboxes } from "applesauce-core/helpers/mailboxes";
import { mergeRelaySets } from "applesauce-core/helpers";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import { FALLBACK_RELAYS } from "@/services/loaders";
import { Nip17Adapter } from "./chat/adapters/nip-17-adapter";
import { isNip05, resolveNip05 } from "@/lib/nip05";
// Import other adapters as they're implemented
// import { Nip28Adapter } from "./chat/adapters/nip-28-adapter";

/**
 * Parse a chat command identifier and auto-detect the protocol
 *
 * Adapter priority:
 * 1. NIP-10 (thread chat) - nevent with kind=1, note1
 * 2. NIP-29 (groups) - relay'group-id format, naddr kind 39000
 * 3. NIP-53 (live chat) - naddr kind 30311
 * 4. NIP-17 (private DMs) - npub1.../nprofile1...
 * 5. NIP-22 (comments) - catch-all: nevent with explicit non-1/30311 kind,
 *    non-NIP-29/53 naddr, URLs, hashtags
 *
 * For nevent/note without kind metadata, fetches the event first and
 * dispatches to the correct adapter based on actual kind.
 *
 * @param args - Command arguments (first arg is the identifier)
 * @returns Parsed result with protocol and identifier
 * @throws Error if no adapter can parse the identifier
 */
export async function parseChatCommand(
  args: string[],
): Promise<ChatCommandResult> {
  if (args.length === 0) {
    throw new Error("Chat identifier required. Usage: chat <identifier>");
  }

  // Handle NIP-29 format that may be split by shell-quote
  // If we have 2 args and they look like relay + group-id, join them with '
  let identifier = args[0];
  if (args.length === 2 && args[0].includes(".") && !args[0].includes("'")) {
    identifier = `${args[0]}'${args[1]}`;
  }

  // Check for kind 10009 (group list) naddr - open multi-room interface
  if (identifier.startsWith("naddr1")) {
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type === "naddr" && decoded.data.kind === 10009) {
        const groupListIdentifier: GroupListIdentifier = {
          type: "group-list",
          value: {
            kind: 10009,
            pubkey: decoded.data.pubkey,
            identifier: decoded.data.identifier,
          },
          relays: decoded.data.relays,
        };
        return {
          protocol: "nip-29",
          identifier: groupListIdentifier,
          adapter: null,
        };
      }
    } catch {
      // Not a valid naddr, continue to adapter parsing
    }
  }

  // A recipient list, before the adapters see it. Two things live here rather
  // than in `Nip17Adapter.parseIdentifier`, and for the same reason: that
  // method is synchronous, and a NIP-05 costs a `.well-known` round trip.
  const recipients = await parseDmRecipients(args);
  if (recipients)
    return {
      protocol: "nip-17",
      identifier: recipients,
      adapter: new Nip17Adapter(),
    };

  // For nevent/note without kind metadata, fetch the event first and
  // dispatch based on actual kind. This MUST run before the adapter loop
  // because NIP-10 claims nevent without kind, which would fail at resolve
  // time for non-kind-1 events.
  const resolved = await resolveAmbiguousIdentifier(identifier);
  if (resolved) return resolved;

  // Try each adapter in priority order
  const adapters = [
    new Nip10Adapter(), // NIP-10 - Thread chat (nevent kind=1 or note1)
    // NIP-17 claims npub/nprofile ONLY. A bare 64-hex string is as plausibly
    // an event id, and silently opening a private conversation with a stranger
    // because someone pasted the wrong thing is the wrong failure. The adapter
    // refuses hex for the same reason — this is not a rule the parser imposes
    // on a looser adapter.
    new Nip17Adapter(), // NIP-17 - Private direct messages
    // new Nip28Adapter(),  // Phase 3
    new Nip29Adapter(), // NIP-29 - Relay groups
    new Nip53Adapter(), // NIP-53 - Live activity chat
    new Nip22Adapter(), // NIP-22 - Comments (catch-all)
  ];

  for (const adapter of adapters) {
    const parsed = adapter.parseIdentifier(identifier);
    if (parsed) {
      return {
        protocol: adapter.protocol,
        identifier: parsed,
        adapter,
      };
    }
  }

  throw new Error(
    `Unable to determine chat protocol from identifier: ${identifier}

Currently supported formats:
  - nevent1.../note1... (NIP-10 thread chat, kind 1 notes)
    Examples:
      chat nevent1qqsxyz... (thread with relay hints)
      chat note1abc... (thread with event ID only)
  - relay.com'group-id (NIP-29 relay group, wss:// prefix optional)
    Examples:
      chat relay.example.com'bitcoin-dev
      chat wss://relay.example.com'nostr-dev
  - naddr1... (NIP-29 group metadata, kind 39000)
    Example:
      chat naddr1qqxnzdesxqmny...
  - naddr1... (NIP-53 live activity chat, kind 30311)
    Example:
      chat naddr1... (live stream address)
  - naddr1... (Multi-room group list, kind 10009)
    Example:
      chat naddr1... (group list address)
  - npub1.../nprofile1.../user@domain (NIP-17 private direct messages)
    Examples:
      chat npub1abc... (a private conversation, gift-wrapped)
      chat nprofile1... (same, with relay hints)
      chat alice@example.com (same, by NIP-05)
      chat npub1abc...,bob@example.com (a group: comma-separated, any mix)
  - nevent1.../naddr1... (NIP-22 comments on any event kind)
    Examples:
      chat nevent1... (comment on article, issue, etc.)
      chat naddr1... (comment on addressable event)
  - https://... (NIP-22 comments on a URL)
    Example:
      chat https://example.com/article
  - #hashtag (NIP-22 comments on a hashtag)
    Example:
      chat #bitcoin
`,
  );
}

/**
 * A private conversation named by the people in it.
 *
 * Claimed here only for what the NIP-17 adapter cannot claim synchronously: a
 * comma-separated list, and a NIP-05 address. A single `npub`/`nprofile` falls
 * through to the adapter, which already handles it and its relay hints.
 *
 * Commas rather than spaces, because the shell tokenizer splits on whitespace
 * and a bare list of npubs would be indistinguishable from a NIP-29 relay and
 * group id. `alice@example.com, bob@example.com` therefore works whether or not
 * the shell kept it in one token.
 *
 * A bare domain is deliberately NOT read as a NIP-05, unlike `profile`: a
 * hostname typed into `chat` is as plausibly a relay, and opening a private
 * conversation with whoever `_@` resolves to is the wrong way to be wrong.
 */
async function parseDmRecipients(args: string[]): Promise<DMIdentifier | null> {
  const parts = args
    .join(" ")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const single = parts.length === 1;
  if (parts.length === 0) return null;
  if (single && !isNip05Address(parts[0])) return null;
  if (!parts.every((part) => looksLikeChatRecipient(part))) return null;

  const pubkeys: string[] = [];
  const relays: string[] = [];
  for (const part of parts) {
    const resolved = await resolveChatRecipient(part);
    if (!resolved)
      throw new Error(
        single
          ? `Could not resolve ${part}. A NIP-05 address has to answer at its own domain.`
          : `Could not resolve ${part}, so this conversation was not opened. A group's participants ARE its identity, and one missing person makes a different conversation.`,
      );
    if (!pubkeys.includes(resolved.pubkey)) pubkeys.push(resolved.pubkey);
    for (const relay of resolved.relays ?? [])
      if (!relays.includes(relay)) relays.push(relay);
  }

  return {
    type: "chat-partner",
    // The participants, for the adapter to normalise — it adds the viewer and
    // sorts, because a conversation id has to be the same string on both sides.
    value: pubkeys.join(":"),
    ...(relays.length > 0 ? { relays } : {}),
  };
}

/** `user@domain`, and not a bare domain. */
function isNip05Address(value: string): boolean {
  return value.includes("@") && isNip05(value);
}

/** Something `resolveChatRecipient` can turn into a pubkey. */
function looksLikeChatRecipient(value: string): boolean {
  return (
    value.startsWith("npub1") ||
    value.startsWith("nprofile1") ||
    isNip05Address(value)
  );
}

/** npub / nprofile / NIP-05 → a pubkey, and any relay hints it carried. */
async function resolveChatRecipient(
  value: string,
): Promise<{ pubkey: string; relays?: string[] } | null> {
  if (value.startsWith("npub1") || value.startsWith("nprofile1")) {
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === "npub") return { pubkey: decoded.data };
      if (decoded.type === "nprofile")
        return {
          pubkey: decoded.data.pubkey,
          ...(decoded.data.relays?.length
            ? { relays: decoded.data.relays }
            : {}),
        };
    } catch {
      return null;
    }
    return null;
  }

  const pubkey = await resolveNip05(value);
  return pubkey ? { pubkey } : null;
}

/**
 * For nevent/note identifiers without kind metadata, fetch the event
 * to determine which adapter should handle it.
 *
 * Returns null for identifiers that already have kind info (adapters handle those)
 * or for non-nevent/note formats.
 */
async function resolveAmbiguousIdentifier(
  input: string,
): Promise<ChatCommandResult | null> {
  let eventId: string | null = null;
  let relayHints: string[] = [];
  let author: string | undefined;

  if (input.startsWith("note1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "note") {
        eventId = decoded.data as string;
      }
    } catch {
      return null;
    }
  } else if (input.startsWith("nevent1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "nevent") {
        // If kind is already defined, let the adapter loop handle it
        if (decoded.data.kind !== undefined) return null;
        eventId = decoded.data.id;
        relayHints = decoded.data.relays || [];
        author = decoded.data.author;
      }
    } catch {
      return null;
    }
  }

  if (!eventId) return null;

  // Fetch the event to determine its kind
  const event = await fetchEventForDispatch(eventId, relayHints, author);
  if (!event) {
    throw new Error(
      "Could not fetch event to determine its kind. The event may not exist or the relays may be unreachable.",
    );
  }

  // Route based on kind
  if (event.kind === 1) {
    const adapter = new Nip10Adapter();
    return {
      protocol: "nip-10",
      identifier: {
        type: "thread",
        value: { id: eventId, relays: relayHints, author, kind: 1 },
        relays: relayHints,
      },
      adapter,
    };
  }

  // Everything else → NIP-22
  const adapter = new Nip22Adapter();
  return {
    protocol: "nip-22",
    identifier: {
      type: "comment",
      value: {
        eventId,
        relays: relayHints,
        author,
        kind: event.kind,
      },
      relays: relayHints,
    },
    adapter,
  };
}

/**
 * Fetch an event by ID to determine its kind for adapter dispatch.
 * Checks EventStore cache first, then fetches from relays.
 * Includes author's outbox relays when available for better discoverability.
 */
async function fetchEventForDispatch(
  eventId: string,
  relayHints: string[],
  authorPubkey?: string,
): Promise<{ kind: number } | null> {
  // Check EventStore cache first (synchronous)
  const cached = eventStore.getEvent(eventId);
  if (cached) return cached;

  // Build relay list: hints + author outbox + fallback relays
  const relaySets: string[][] = [];
  if (relayHints.length > 0) relaySets.push(relayHints);

  // Include author's outbox relays if we have their pubkey
  if (authorPubkey) {
    const relayList = eventStore.getReplaceable(10002, authorPubkey, "");
    if (relayList) {
      relaySets.push(getOutboxes(relayList).slice(0, 3));
    }
  }

  relaySets.push(FALLBACK_RELAYS);
  const relays = mergeRelaySets(...relaySets);

  const filter = { ids: [eventId], limit: 1 };

  try {
    const events = await firstValueFrom(
      pool.request(relays, [filter], { eventStore }).pipe(
        rxTimeout(10_000),
        toArray(),
        catchError(() => of([])),
      ),
    );
    return events[0] || null;
  } catch {
    return null;
  }
}
