/**
 * Accepting an invite — the one place grimoire writes a membership.
 *
 * Everything else about Concord here is a read. This is not, and the order of
 * the two publishes is the whole design (see `lib/concord/join.ts`): the
 * Community List first, because it is the member's only copy of their own
 * keys; the Guestbook Join second and best-effort, because it is off-consensus
 * and nothing depends on it.
 *
 * Which generations get written is decided by what the member already has,
 * never by which one the spec prefers: a member whose other clients read the
 * retired single-event List must not have their join land somewhere those
 * clients never look. Holding both generations, they get both — see
 * `planWrites`, where the asymmetry between them lives. A member with no List
 * at all gets the retired kind, which is what the ecosystem reads today.
 */

import { hex32 } from "@/lib/concord/derive";
import { guestbookGroupKey } from "@/lib/concord/derive";
import { mergeCommunityLists } from "@/lib/concord/community-list";
import type {
  CommunityList,
  CommunityListEntry,
} from "@/lib/concord/community-list";
import { inviteExpired, type InviteBundle } from "@/lib/concord/invite";
import {
  entryFromBundle,
  joinTags,
  JOIN_RUMOR,
  LIST_MAX_BYTES,
  serializeCommunityList,
} from "@/lib/concord/join";
import {
  KIND_COMMUNITY_LIST,
  KIND_COMMUNITY_LIST_LEGACY,
  KIND_SEAL_ENCRYPTED,
} from "@/lib/concord/kinds";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { StreamSigner } from "@/lib/concord/stream";
import { capRelays } from "@/lib/concord/types";
import {
  mirroredMembershipCount,
  readListSlotsForWrite,
  syncCommunities,
} from "@/services/concord-communities";
import { publishWrap } from "@/services/concord-publish";
import { publishEvent } from "@/services/hub";
import type { NostrEvent } from "@/types/nostr";

/** The signer surface a join needs: sign, and NIP-44 both ways. */
export interface JoinSigner extends StreamSigner {
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

export interface JoinOutcome {
  communityId: string;
  /** Which generations of the List the membership was written into. */
  listKinds: number[];
  /** The Guestbook is off-consensus: a failure here costs visibility only. */
  guestbook: "published" | "failed";
  guestbookError?: string;
}

export class JoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JoinError";
  }
}

/** One slot as {@link readListSlotsForWrite} hands it over. */
type WriteSlot = Awaited<
  ReturnType<typeof readListSlotsForWrite>
>["slots"][number];

/** A List event this join will publish, already merged and addressed. */
interface ListWrite {
  kind: number;
  d: string;
  list: CommunityList;
  /** The copy being replaced, whose `created_at` the write must outrank. */
  replaces?: WriteSlot;
  /**
   * What to write instead when {@link list} does not fit in one event.
   *
   * Only the convergence half of a write is ever optional: carrying the other
   * generation's memberships across is worth an event, never a refused join.
   */
  ifTooLarge?: CommunityList;
}

/**
 * Which documents this join rewrites, and what each of them says afterwards.
 *
 * A member can hold BOTH generations at once — armada writes the retired
 * single-event List, other clients write §8 fragments — and a join that lands
 * in only one of them is invisible in whatever reads the other. Every reader
 * unions across generations, so writing to both is not duplication with a cost:
 * it is how the two documents stop drifting apart.
 *
 * The two are not filled the same way, and that asymmetry is the point:
 *
 * - The **retired List** is one document for everything, so it takes the whole
 *   cross-generation union. That is the convergence move — a membership living
 *   only in a fragment reaches armada by riding here.
 * - A **fragment** is §8's answer to one event being too small, so it takes its
 *   OWN page plus the new entry and nothing else. Folding the union into a page
 *   would undo the packing and walk it into the relay's refusal line.
 *
 * A member with no List at all gets the retired kind, which is what the
 * ecosystem reads today; one holding only fragments gets a fragment, because
 * re-minting a generation they have migrated off is not this client's call.
 */
function planWrites(
  slots: WriteSlot[],
  entry: CommunityListEntry,
  communityId: string,
): ListWrite[] {
  const justJoined: CommunityList = { entries: [entry], tombstones: [] };
  if (slots.length === 0) {
    return [{ kind: KIND_COMMUNITY_LIST_LEGACY, d: "", list: justJoined }];
  }

  const fragments = slots.filter((slot) => slot.kind === KIND_COMMUNITY_LIST);
  const legacy = slots.find((slot) => slot.kind === KIND_COMMUNITY_LIST_LEGACY);
  const writes: ListWrite[] = [];

  if (legacy) {
    writes.push({
      kind: KIND_COMMUNITY_LIST_LEGACY,
      d: "",
      list: mergeCommunityLists([
        ...slots.map((slot) => ({ list: slot.list })),
        { list: justJoined },
      ]),
      // Convergence is what the union buys, and it is worth exactly one event.
      // A union that outgrows one drops back to this document's own contents
      // plus the join: the generations stay apart, which is the state we were
      // already in, rather than the member being unable to join at all.
      ifTooLarge: mergeCommunityLists([
        { list: legacy.list },
        { list: justJoined },
      ]),
      replaces: legacy,
    });
  }

  // Re-joining rewrites the page that already holds the membership; otherwise
  // the freshest page, which is the one whoever maintains this generation last
  // touched. Equal ages break to the lowest index, so two devices deciding
  // independently pick the same page.
  const holding = fragments.find((slot) =>
    slot.list.entries.some(
      (e) => e.community_id?.toLowerCase() === communityId,
    ),
  );
  const newest = fragments.reduce<WriteSlot | undefined>(
    (best, slot) =>
      !best ||
      slot.createdAt > best.createdAt ||
      (slot.createdAt === best.createdAt && slot.d < best.d)
        ? slot
        : best,
    undefined,
  );
  const fragment = holding ?? newest;
  if (fragment) {
    writes.push({
      kind: KIND_COMMUNITY_LIST,
      d: fragment.d,
      list: mergeCommunityLists([
        { list: fragment.list },
        { list: justJoined },
      ]),
      replaces: fragment,
    });
  }
  return writes;
}

/**
 * Sign every planned write, size them ALL, then publish.
 *
 * Sizing both documents before either goes out is what keeps a partial join
 * from happening: a fragment that overflows must not be discovered after the
 * retired List has already landed, leaving the member's clients disagreeing
 * about what they hold with no way to tell which is right.
 *
 * An overflowing write narrows if it can (`ifTooLarge`) and is dropped if it
 * still cannot fit — joining outranks converging. The join only FAILS when
 * nothing fits at all, which is the member genuinely needing a repack.
 *
 * @returns the kinds actually published, in the order they went out.
 */
async function writeMembership(
  slots: WriteSlot[],
  entry: CommunityListEntry,
  communityId: string,
  { pubkey, signer }: { pubkey: string; signer: JoinSigner },
): Promise<number[]> {
  const nip44 = signer.nip44;
  if (!nip44) throw new JoinError("This signer cannot join: NIP-44 is needed.");

  const sign = async (write: ListWrite, list: CommunityList) => {
    const json = serializeCommunityList(
      list,
      // §8 fixes unpadded base64url for the fragmented kind; the retired one
      // predates that rule and is written in hex by the clients still reading it.
      write.kind === KIND_COMMUNITY_LIST ? "base64url" : "hex",
    );
    return signer.signEvent({
      kind: write.kind,
      content: await nip44.encrypt(pubkey, json),
      // The fragmented kind is addressable and keyed by its index; the retired
      // one is replaceable and carries no identifier at all.
      tags: write.kind === KIND_COMMUNITY_LIST ? [["d", write.d]] : [],
      // Relays resolve a replacement on `created_at` alone and break ties on the
      // LOWEST id, so a write sharing a second with the copy it replaces can be
      // silently discarded (CORD-02 §8).
      created_at: Math.max(
        Math.floor(Date.now() / 1000),
        (write.replaces?.createdAt ?? 0) + 1,
      ),
    });
  };
  // Measured on the FULLY ENCODED event, after encryption and signing: the
  // NIP-44 plaintext understates it by roughly a third, so a List that passes a
  // plaintext check can still be refused by every relay — freezing the member's
  // memberships at their last accepted state with no error raised anywhere.
  const fits = (event: NostrEvent) =>
    JSON.stringify(event).length <= LIST_MAX_BYTES;

  const signed: NostrEvent[] = [];
  for (const write of planWrites(slots, entry, communityId)) {
    let event = await sign(write, write.list);
    if (!fits(event) && write.ifTooLarge) {
      event = await sign(write, write.ifTooLarge);
    }
    if (fits(event)) signed.push(event);
  }
  if (signed.length === 0) {
    throw new JoinError(
      "Your Community List is too large for one event, and splitting it across fragments is not something this client does. Join in Armada, which can repack it.",
    );
  }

  const written: number[] = [];
  for (const event of signed) {
    try {
      await publishEvent(event);
      written.push(event.kind);
    } catch (error) {
      // The FIRST failure is the join failing: nothing landed. A later one is
      // not — the membership is already in a document every reader unions
      // from, and the generations converge on the next join or repack. Failing
      // the whole join there would tell the member they are not in a community
      // they are in.
      if (written.length === 0) {
        throw new JoinError(
          `Your membership could not be saved: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      console.warn(
        `[concord] the membership landed, but kind ${event.kind} was not updated:`,
        error,
      );
    }
  }
  return written;
}

/**
 * Accept an invite: write the membership, then announce it.
 *
 * Refuses an expired bundle — the preview still renders past `expires_at`, but
 * joining is exactly what that field bounds.
 */
export async function joinFromInvite(
  bundle: InviteBundle,
  pubkey: string,
  signer: JoinSigner,
): Promise<JoinOutcome> {
  if (!signer.nip44) {
    throw new JoinError(
      "This signer cannot join: the Community List is encrypted to yourself, which needs NIP-44.",
    );
  }
  if (inviteExpired(bundle)) {
    throw new JoinError("This invite has expired.");
  }

  const communityId = bundle.community_id.toLowerCase();
  const entry = entryFromBundle(bundle);

  // §8's read-modify-write: fetched fresh, never built from the local mirror,
  // or a join silently drops whatever another device published since the last
  // sync — including that device's own channel keys.
  const { slots, unreadable } = await readListSlotsForWrite(pubkey, signer);
  if (unreadable > 0) {
    // A slot this client cannot open is a slot it must not rewrite: the write
    // REPLACES the coordinate, so publishing over an unreadable fragment
    // destroys every membership in it — and what a membership holds is the
    // member's only copy of their channel keys.
    throw new JoinError(
      "Part of your Community List would not decrypt just now, so nothing was written. Check the signer holding your key and try again.",
    );
  }
  if (slots.length === 0 && (await mirroredMembershipCount(pubkey)) > 0) {
    // The vault says memberships exist but no relay served the document that
    // holds them. Writing a fresh List here would replace it with this one
    // membership alone, wiping the rest.
    throw new JoinError(
      "Your Community List could not be read from any relay just now, so nothing was written — joining would have replaced the memberships it holds.",
    );
  }
  const written = await writeMembership(slots, entry, communityId, {
    pubkey,
    signer,
  });

  // The vault is what the rest of the client reads, and it is also what proves
  // the write round-trips: re-reading now means the community appears with the
  // keys as they came back off the wire, not as we hoped they went out.
  await syncCommunities(pubkey, signer).catch(() => undefined);

  const outcome: JoinOutcome = {
    communityId,
    listKinds: written,
    guestbook: "published",
  };
  try {
    await publishGuestbookJoin(bundle, pubkey, signer);
  } catch (error) {
    outcome.guestbook = "failed";
    outcome.guestbookError =
      error instanceof Error ? error.message : String(error);
  }
  return outcome;
}

/**
 * Publish the member's own word that they are here (CORD-02 §5).
 *
 * Self-signed inside the seal, wrapped at the Guestbook's address under the
 * community root every member holds — necessarily member-writable, unlike the
 * Control Plane, because a Join is nobody else's statement to make.
 */
async function publishGuestbookJoin(
  bundle: InviteBundle,
  pubkey: string,
  signer: JoinSigner,
): Promise<void> {
  const group = guestbookGroupKey(
    hex32(bundle.community_root),
    hex32(bundle.community_id),
    BigInt(bundle.root_epoch),
  );
  const rumor = buildRumor({
    kind: JOIN_RUMOR.kind,
    content: JOIN_RUMOR.content,
    tags: joinTags(bundle),
    pubkey,
    ms: Date.now(),
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, group, signer);
  const wrap = wrapSeal(seal, group);
  const relays = capRelays(Array.isArray(bundle.relays) ? bundle.relays : []);
  await publishWrap(relays, wrap);
}
