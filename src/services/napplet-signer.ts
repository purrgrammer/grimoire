/**
 * The signing gate for napplets.
 *
 * Kehto's `ConsentRequest` documents a `'destructive-signing'` type and its
 * JSDoc claims kinds 0, 3, 5 and 10002 are gated — but grepping
 * `@kehto/runtime@0.21.0`'s dist for that string returns nothing. The only
 * consent the runtime fires is `'firewall-policy'`. Both `relay.publish` and
 * `relay.publishEncrypted` reach `auth.getSigner().signEvent` with no prompt of
 * any kind.
 *
 * So the prompt is ours. Everything a napplet signs passes through this
 * wrapper; grimoire's own signing uses `accountManager` directly and is
 * unaffected.
 */

import type { EventTemplate, NostrEvent } from "nostr-tools";
import accountManager from "./accounts";
import { requestSigningConsent } from "./napplet-consent";

/**
 * Kinds that overwrite or destroy existing user state, rather than adding to
 * it. Publishing one of these as the user is not recoverable by publishing
 * again, so each is confirmed individually even when `relay:write` is granted.
 */
const DESTRUCTIVE_KINDS = new Set([
  0, // profile metadata — overwrites the user's identity
  3, // follow list — a wipe is indistinguishable from an edit
  5, // deletion request
  10002, // relay list — can silently isolate the user
]);

export function isDestructiveKind(kind: number): boolean {
  return DESTRUCTIVE_KINDS.has(kind);
}

/**
 * A signer for napplet-originated operations only.
 *
 * `relay:write` is the standing grant to publish as the user; it is asked for
 * once and remembered. This layer adds a per-event confirmation on top for the
 * operations a standing grant should not cover.
 */
export function createNappletSigner() {
  const account = () => accountManager.active;

  const confirm = (summary: string, detail: string) =>
    requestSigningConsent({ summary, detail });

  return {
    getPublicKey: () => account()?.pubkey ?? "",

    async signEvent(template: EventTemplate | NostrEvent): Promise<NostrEvent> {
      const active = account();
      if (!active) throw new Error("No account is signed in.");

      if (isDestructiveKind(template.kind)) {
        const allowed = await confirm(
          `sign a kind ${template.kind} event as you`,
          describeDestructive(template.kind),
        );
        if (!allowed) throw new Error("Signing refused.");
      }

      return active.signEvent(template) as Promise<NostrEvent>;
    },

    // Encryption to a napplet-chosen recipient is an exfiltration channel — the
    // napplet supplies both the plaintext and who receives it — so it is always
    // confirmed, regardless of kind.
    nip44: {
      encrypt: async (pubkey: string, plaintext: string) => {
        const active = account();
        if (!active?.nip44) throw new Error("NIP-44 unavailable.");
        const allowed = await confirm(
          "send an encrypted message as you",
          `Recipient ${pubkey.slice(0, 12)}…, ${plaintext.length} characters.`,
        );
        if (!allowed) throw new Error("Encryption refused.");
        return active.nip44.encrypt(pubkey, plaintext);
      },
      decrypt: async (pubkey: string, ciphertext: string) => {
        const active = account();
        if (!active?.nip44) throw new Error("NIP-44 unavailable.");
        const allowed = await confirm(
          "read one of your encrypted messages",
          `From ${pubkey.slice(0, 12)}…`,
        );
        if (!allowed) throw new Error("Decryption refused.");
        return active.nip44.decrypt(pubkey, ciphertext);
      },
    },
  };
}

function describeDestructive(kind: number): string {
  switch (kind) {
    case 0:
      return "This replaces your profile metadata.";
    case 3:
      return "This replaces your entire follow list.";
    case 5:
      return "This asks relays to delete one of your events.";
    case 10002:
      return "This replaces your relay list and can cut you off from relays.";
    default:
      return "This overwrites existing data published under your identity.";
  }
}
