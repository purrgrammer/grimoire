import { WebSocketServer } from "ws";
import { verifyEvent } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

/**
 * Minimal in-process relay for tests.
 *
 * Exists because the relay behaviours that break clients are the awkward ones —
 * a relay that connects and then says nothing, or refuses a REQ with
 * `auth-required`, or closes a subscription right after EOSE. Those are hard to
 * find in the wild and impossible to rely on in CI, but each has caused a real
 * hang or request flood in this codebase.
 */
export type MockRelayBehaviour =
  /** Serve `events`, then EOSE. The well-behaved case. */
  | { kind: "normal"; events?: NostrEvent[] }
  /** Refuse every REQ with `auth-required` and never send an AUTH frame. */
  | { kind: "auth-required" }
  /** Accept the REQ and then say nothing at all. */
  | { kind: "silent" }
  /** EOSE, then an unprefixed CLOSED — what triggers resubscribe. */
  | { kind: "close-after-eose"; events?: NostrEvent[] }
  /**
   * NIP-42 gating, ditto-relay style: challenges on connect, keeps a
   * per-connection SET of authenticated pubkeys, and serves a REQ only when
   * every `authors` entry is in it. The challenge stays valid for the socket's
   * lifetime, so a key can authenticate after the REQ was already refused.
   *
   * This is the shape Concord needs — its plane REQs are authored by derived
   * stream pubkeys, never the user's, so one authenticated identity is never
   * enough.
   *
   * Verified against a live ditto-relay (relay.dreamith.to), which refuses with
   * `auth-required: all authors or all #p tags must be authenticated`, accepts
   * an AUTH for an arbitrary derived pubkey, and serves the re-issued REQ on the
   * same socket.
   */
  | { kind: "nip42-gated"; events?: NostrEvent[] }
  /**
   * Serves `events` through REAL filter semantics — `authors`, `kinds`,
   * `since`, `until` (inclusive), newest-first, capped at `limit` and at the
   * relay's own `pageLimit`.
   *
   * The paged behaviours are what a history walker actually has to survive, and
   * the other modes here all answer every REQ identically, which cannot
   * exercise a cursor at all. `pageLimit` models a relay whose page cap is
   * LOWER than what the client asked for — the case that makes "did that drain
   * the second?" unanswerable.
   */
  | {
      kind: "paged";
      events: NostrEvent[];
      /** The relay's own cap, applied after `limit`. Default: no extra cap. */
      pageLimit?: number;
      /**
       * Hold each answer for this long before sending it. A slow relay is the
       * only way to make "something happened WHILE a read was in flight"
       * deterministic — without it the round trip can finish before a
       * `setTimeout(0)` fires, and a race test silently stops testing the race.
       */
      delayMs?: number;
    };

export interface MockRelay {
  url: string;
  /**
   * Push an event to every subscription currently open, as a LIVE arrival
   * (post-EOSE).
   *
   * Without this the mock can only answer a one-shot: every behaviour above
   * serves its stored events and EOSEs. A standing subscription's entire
   * purpose is what happens after that, so nothing about the wire's live path —
   * ingest latency, the quiet-rotation watchdog, the bus ring — is testable
   * without a relay that can speak first.
   */
  push: (event: NostrEvent) => void;
  /** Events this relay accepted, in arrival order. */
  accepted: () => NostrEvent[];
  /** REQ frames received, for asserting a client isn't flooding. */
  reqCount: () => number;
  /**
   * Every filter this relay has been asked for, in arrival order. A resume
   * cursor is only observable here — the events a relay serves say nothing
   * about the `since` that was asked for.
   */
  reqFilters: () => Array<Record<string, unknown>>;
  /**
   * Pubkeys that have authenticated, unioned across connections
   * (`nip42-gated` only). Gating itself is per-connection; this is a union
   * because tests use one socket and asserting on it is simpler.
   */
  authedPubkeys: () => string[];
  close: () => Promise<void>;
}

/** Start a mock relay on an ephemeral port. Always `await relay.close()`. */
export async function startMockRelay(
  behaviour: MockRelayBehaviour,
): Promise<MockRelay> {
  const server = new WebSocketServer({ port: 0 });
  let reqs = 0;
  const stored: NostrEvent[] = [];
  const seenFilters: Array<Record<string, unknown>> = [];
  const allAuthed = new Set<string>();

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  /** Every open subscription, so `push` can reach them. */
  const live = new Set<{ socket: import("ws").WebSocket; subId: string }>();

  server.on("connection", (socket) => {
    // Per-connection auth state. The challenge is minted once and stays valid
    // for the socket's lifetime, so a key registered after the first REQ can
    // still authenticate without a reconnect.
    const challenge = `challenge-${Math.random().toString(36).slice(2)}`;
    const authed = new Set<string>();
    if (behaviour.kind === "nip42-gated") {
      socket.send(JSON.stringify(["AUTH", challenge]));
    }

    socket.on("close", () => {
      for (const entry of live) if (entry.socket === socket) live.delete(entry);
    });

    socket.on("message", (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(message)) return;

      if (message[0] === "AUTH" && behaviour.kind === "nip42-gated") {
        const event = message[1] as NostrEvent | undefined;
        const ok =
          !!event &&
          event.kind === 22242 &&
          event.tags.some((t) => t[0] === "challenge" && t[1] === challenge) &&
          verifyEvent(event);
        if (ok) {
          authed.add(event.pubkey);
          allAuthed.add(event.pubkey);
        }
        socket.send(
          JSON.stringify([
            "OK",
            event?.id ?? "",
            ok,
            ok ? "" : "invalid: bad auth event",
          ]),
        );
        return;
      }

      if (message[0] === "EVENT") {
        // A relay that ignores EVENT frames is not a behaviour worth modelling —
        // it just hangs every publish on its timeout. `nip42-gated` mirrors what
        // a ditto relay with kind 1059 in AUTH_KINDS does to a WRITE: the
        // author must be authenticated on this connection, which for a Concord
        // wrap means the stream key that signed it.
        const event = message[1] as NostrEvent | undefined;
        if (!event || typeof event.id !== "string") return;
        if (behaviour.kind === "auth-required") {
          socket.send(
            JSON.stringify(["OK", event.id, false, "auth-required: need auth"]),
          );
          return;
        }
        if (behaviour.kind === "nip42-gated" && !authed.has(event.pubkey)) {
          socket.send(
            JSON.stringify([
              "OK",
              event.id,
              false,
              `auth-required: not authenticated as ${event.pubkey}`,
            ]),
          );
          return;
        }
        if (behaviour.kind === "silent") return;
        stored.push(event);
        socket.send(JSON.stringify(["OK", event.id, true, ""]));
        return;
      }

      if (message[0] === "CLOSE") {
        for (const entry of live) {
          if (entry.socket === socket && entry.subId === message[1]) {
            live.delete(entry);
          }
        }
        return;
      }

      if (message[0] !== "REQ") return;

      reqs++;
      for (const filter of message.slice(2)) {
        seenFilters.push(filter as Record<string, unknown>);
      }
      const subId = message[1] as string;
      // A REQ that is not refused leaves a standing subscription behind, which
      // is what `push` delivers to. Refusing branches below return early.
      live.add({ socket, subId });

      if (behaviour.kind === "nip42-gated") {
        // Every `authors` entry must be authenticated on THIS connection —
        // one authenticated identity does not cover a filter authored by
        // another pubkey.
        const wanted = (
          message.slice(2) as Array<{ authors?: string[] }>
        ).flatMap((f) => f.authors ?? []);
        const missing = wanted.filter((pk) => !authed.has(pk));
        if (missing.length > 0) {
          for (const entry of live) {
            if (entry.socket === socket && entry.subId === subId) {
              live.delete(entry);
            }
          }
          socket.send(
            JSON.stringify([
              "CLOSED",
              subId,
              `auth-required: not authenticated as ${missing[0]}`,
            ]),
          );
          return;
        }
        for (const event of behaviour.events ?? []) {
          socket.send(JSON.stringify(["EVENT", subId, event]));
        }
        socket.send(JSON.stringify(["EOSE", subId]));
        return;
      }

      if (behaviour.kind === "paged") {
        const filters = message.slice(2) as MockFilter[];
        const matched = new Map<string, NostrEvent>();
        for (const filter of filters) {
          for (const event of servePage(behaviour, filter)) {
            matched.set(event.id, event);
          }
        }
        const answer = () => {
          for (const event of matched.values()) {
            socket.send(JSON.stringify(["EVENT", subId, event]));
          }
          socket.send(JSON.stringify(["EOSE", subId]));
        };
        if (behaviour.delayMs) setTimeout(answer, behaviour.delayMs);
        else answer();
        return;
      }

      switch (behaviour.kind) {
        case "normal":
        case "close-after-eose":
          for (const event of behaviour.events ?? []) {
            socket.send(JSON.stringify(["EVENT", subId, event]));
          }
          socket.send(JSON.stringify(["EOSE", subId]));
          if (behaviour.kind === "close-after-eose") {
            socket.send(JSON.stringify(["CLOSED", subId, ""]));
          }
          break;

        case "auth-required":
          for (const entry of live) {
            if (entry.socket === socket && entry.subId === subId) {
              live.delete(entry);
            }
          }
          socket.send(
            JSON.stringify(["CLOSED", subId, "auth-required: need auth"]),
          );
          break;

        case "silent":
          break;
      }
    });
  });

  return {
    url: `ws://localhost:${port}`,
    push: (event: NostrEvent) => {
      for (const { socket, subId } of live) {
        socket.send(JSON.stringify(["EVENT", subId, event]));
      }
    },
    accepted: () => [...stored],
    reqCount: () => reqs,
    reqFilters: () => [...seenFilters],
    authedPubkeys: () => [...allAuthed],
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

interface MockFilter {
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
}

/**
 * One page for one filter: matching events newest-first, `until` INCLUSIVE
 * (as NIP-01 has it — the inclusivity is what makes a same-second wall
 * possible), truncated by the filter's `limit` and then by the relay's own cap.
 */
function servePage(
  behaviour: { events: NostrEvent[]; pageLimit?: number },
  filter: MockFilter,
): NostrEvent[] {
  const matched = behaviour.events
    .filter((e) => {
      if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
      if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
      if (filter.since !== undefined && e.created_at < filter.since)
        return false;
      if (filter.until !== undefined && e.created_at > filter.until)
        return false;
      return true;
    })
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  const asked = filter.limit ?? matched.length;
  return matched.slice(0, Math.min(asked, behaviour.pageLimit ?? asked));
}

/** An unsigned-but-shaped event, good enough for relay plumbing tests. */
export function fakeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  const id = (overrides.id ?? "").padEnd(64, "a").slice(0, 64);
  return {
    id: id || "a".repeat(64),
    kind: 1,
    pubkey: "b".repeat(64),
    created_at: 1_700_000_000,
    content: "test",
    tags: [],
    sig: "c".repeat(128),
    ...overrides,
  } as NostrEvent;
}
