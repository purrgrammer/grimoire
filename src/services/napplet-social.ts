/**
 * NAP-COMMON, NAP-LISTS and NAP-LINK.
 *
 * These three are the reason this file exists separately. In the shipped
 * `@kehto/acl`, `resolveCapabilitiesNap` has no `case` for `common`, `lists` or
 * `link`, so they fall to `{senderCap: null, recipientCap: null}` — and the
 * call site is `if (caps.senderCap) { …enforceNap… }`. A null capability does
 * not fail the check; **no check runs at all**.
 *
 * That means `follow`, `unfollow`, `react`, `report` and every NIP-51 list
 * mutation would execute as the user with nothing between the napplet and the
 * signature. The ACL grant model cannot help, because there is no capability to
 * grant or withhold.
 *
 * So every mutating hook here confirms individually, in the user's terms,
 * naming the napplet. Reads are answered without a prompt; writes are not.
 */

import {
  createCommonService,
  createListsService,
  createLinkService,
} from "./kehto";
import { FollowUser, UnfollowUser } from "applesauce-actions/actions";
import { getProfileContent } from "applesauce-core/helpers";

import { getHub, publishEvent } from "./hub";
import { createNappletSigner } from "./napplet-signer";
import accountManager from "./accounts";
import defaultEventStore from "./event-store";
import { requestSigningConsent } from "./napplet-consent";

/** Short label for a pubkey in a confirmation prompt. */
function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

const nappletSigner = createNappletSigner();

function activePubkey(): string | null {
  return accountManager.active?.pubkey ?? null;
}

function readFollows(pubkey: string): string[] {
  const event = defaultEventStore.getReplaceable(3, pubkey);
  if (!event) return [];
  return event.tags
    .filter((t) => t[0] === "p" && t[1]?.length === 64)
    .map((t) => t[1]);
}

/**
 * NAP-COMMON. Reads pass through; every write is confirmed because nothing
 * else will confirm it.
 */
export function createNappletCommonService() {
  return createCommonService({
    getProfile: (target) => {
      const pubkey = String(target ?? "");
      if (!pubkey) return { ok: false, pubkey: "", error: "no pubkey" };
      const event = defaultEventStore.getReplaceable(0, pubkey);
      return event
        ? { ok: true, pubkey, profile: getProfileContent(event) }
        : { ok: false, pubkey, error: "profile not found" };
    },

    follows: () => {
      const pubkey = activePubkey();
      if (!pubkey) return { ok: false, pubkeys: [], error: "not signed in" };
      return { ok: true, pubkeys: readFollows(pubkey) };
    },

    follow: async (pubkeys) => {
      const allowed = await requestSigningConsent({
        summary: `follow ${pubkeys.length === 1 ? shortPubkey(pubkeys[0]) : `${pubkeys.length} accounts`} as you`,
        detail: "This edits your public follow list.",
      });
      if (!allowed) return { ok: false, error: "refused" };
      for (const pubkey of pubkeys) await getHub().run(FollowUser, pubkey);
      return { ok: true };
    },

    unfollow: async (pubkeys) => {
      const allowed = await requestSigningConsent({
        summary: `unfollow ${pubkeys.length === 1 ? shortPubkey(pubkeys[0]) : `${pubkeys.length} accounts`} as you`,
        detail: "This edits your public follow list.",
      });
      if (!allowed) return { ok: false, error: "refused" };
      for (const pubkey of pubkeys) await getHub().run(UnfollowUser, pubkey);
      return { ok: true };
    },

    react: async (targetEventId, reaction) => {
      const target = defaultEventStore.getEvent(targetEventId);
      if (!target) {
        return { ok: false, error: "target event not found" };
      }

      const symbol = String(reaction || "+").slice(0, 32);
      const allowed = await requestSigningConsent({
        summary: `react "${symbol}" as you`,
        detail: `On a kind ${target.kind} event by ${shortPubkey(target.pubkey)}.`,
      });
      if (!allowed) return { ok: false, error: "refused" };

      // NIP-25: e and p identify the target, k carries its kind so clients can
      // route the reaction without fetching the event first.
      const signed = await nappletSigner.signEvent({
        kind: 7,
        content: symbol,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["e", target.id],
          ["p", target.pubkey],
          ["k", String(target.kind)],
        ],
      });
      await publishEvent(signed);
      return { ok: true, eventId: signed.id, event: signed };
    },

    report: async () => {
      // Filing a report as the user is a public accusation. It stays off until
      // there is a real review step, and saying so beats a silent no-op.
      return { ok: false, error: "reporting from a napplet is not supported" };
    },
  });
}

/**
 * NAP-LISTS, which grimoire does not implement.
 *
 * `supported: []` rather than a list of kinds, because refusing every mutation
 * while advertising three of them is the same lie as `notify` fabricating a
 * delivery id. The confirmation prompt is gone with it: asking the user to
 * approve a signed edit to their mute list and *then* refusing unconditionally
 * is worse than either half alone — it spends the user's attention and teaches
 * them the prompt is noise.
 *
 * Restoring this means implementing the edits; the shape is already here in
 * `follow`/`unfollow` above, which do go through the hub.
 */
export function createNappletListsService() {
  const unsupported = {
    ok: false,
    error: "unsupported" as const,
    reason: "grimoire cannot edit lists from a napplet",
    supported: [],
  };
  return createListsService({
    supported: () => [],
    add: async () => unsupported,
    remove: async () => unsupported,
  });
}

/**
 * NAP-LINK. Navigation the napplet controls, with no capability behind it.
 *
 * Restricted to https so `javascript:`, `file:`, `data:` and custom app schemes
 * cannot be reached, and confirmed each time so a napplet cannot silently
 * redirect the user.
 */
export function createNappletLinkService() {
  return createLinkService({
    allowedProtocols: ["https:"],
    open: async (context) => {
      const url = String((context as { url?: unknown }).url ?? "");
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { status: "denied" };
      }
      if (parsed.protocol !== "https:") return { status: "denied" };

      const allowed = await requestSigningConsent({
        summary: "open a link in a new tab",
        detail: parsed.origin + parsed.pathname,
      });
      if (!allowed) return { status: "denied" };
      window.open(parsed.href, "_blank", "noopener,noreferrer");
      return { status: "opened" };
    },
  });
}
