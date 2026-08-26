/**
 * Joining — the first thing grimoire WRITES about membership.
 *
 * Two publishes, in this order, because they have different consequences:
 *
 * 1. **The Community List** (CORD-02 §8) — the member's own vault, encrypted to
 *    themselves. This is what makes the membership survive a reload and reach
 *    their other devices and clients. Everything else is decoration; if this
 *    does not land, the join did not happen.
 * 2. **A Guestbook Join** (CORD-02 §5) — the member's own word that they are
 *    here, self-signed, echoing the invite's attribution when it carries one.
 *    Off-consensus by design: nothing in Control or Chat depends on it, so a
 *    failure here costs visibility in a members list, never access.
 *
 * Possession of the keys IS membership (CORD-02 §2). Neither publish grants
 * anything — the bundle already did.
 *
 * **The List is the member's only copy of their own channel keys**, and §8 is
 * blunt about what a careless writer costs them: dropping a field it does not
 * understand destroys that material on every device its holder owns, with no
 * later upgrade able to recover it. So every write here is a read-modify-write
 * over the newest copy of the fragment being rewritten, and every unknown field
 * rides through verbatim, at every level.
 */

import { KIND_JOIN_LEAVE } from "@/lib/concord/kinds";
import type {
  CommunityList,
  CommunityListEntry,
  JoinMaterial,
} from "@/lib/concord/community-list";
import type { InviteBundle } from "@/lib/concord/invite";

/** §8's own advice: pack well under the 65,536-byte refusal line. */
export const LIST_TARGET_BYTES = 56 * 1024;
/** The relay ceiling itself. A fragment at it is a lottery between relays. */
export const LIST_MAX_BYTES = 65_536;

/**
 * The membership subset of a bundle (CORD-02 §8): keys and coordinates, never
 * the icon (a device folds that from the Control Plane) and never the link
 * fields — expiry and attribution belong to the invite, not the membership.
 */
export function joinMaterialFromBundle(bundle: InviteBundle): JoinMaterial {
  const {
    community_id,
    owner,
    owner_salt,
    community_root,
    root_epoch,
    control_pk,
    channels,
    relays,
    name,
  } = bundle;
  return {
    community_id,
    owner,
    owner_salt,
    community_root,
    root_epoch,
    ...(control_pk ? { control_pk } : {}),
    channels: Array.isArray(channels) ? channels : [],
    relays: Array.isArray(relays) ? relays : [],
    name: typeof name === "string" ? name : "",
  };
}

/**
 * The entry a fresh join adds.
 *
 * `seed` and `current` are the same snapshot at a join: the earliest epoch this
 * member ever held IS the one they were just handed. They diverge later, at the
 * first Refounding.
 */
export function entryFromBundle(
  bundle: InviteBundle,
  addedAtMs = Date.now(),
): CommunityListEntry {
  const jm = joinMaterialFromBundle(bundle);
  return {
    community_id: bundle.community_id,
    seed: jm,
    current: jm,
    added_at: addedAtMs,
    ...(typeof bundle.label === "string" && bundle.label
      ? { invite_ref: bundle.label }
      : {}),
  };
}

// ── Serialization ───────────────────────────────────────────────────────────

/** 43 characters of unpadded base64url, the §8 spelling of 32 bytes. */
function hexToB64url(hex: string): string {
  let bin = "";
  for (let i = 0; i < hex.length; i += 2) {
    bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const HEX32 = /^[0-9a-f]{64}$/i;

/** The §8-named 32-byte fields, by the object they appear on. */
const NAMED_ON_MATERIAL = [
  "community_id",
  "owner",
  "owner_salt",
  "community_root",
  "control_pk",
  "control_root",
  "refounder",
];

function encodeField(obj: Record<string, unknown>, key: string) {
  const value = obj[key];
  if (typeof value === "string" && HEX32.test(value)) {
    obj[key] = hexToB64url(value.toLowerCase());
  }
}

function encodeMaterial(jm: Record<string, unknown> | undefined) {
  if (!jm || typeof jm !== "object") return;
  for (const key of NAMED_ON_MATERIAL) encodeField(jm, key);
  for (const ch of Array.isArray(jm.channels) ? jm.channels : []) {
    if (!ch || typeof ch !== "object") continue;
    const channel = ch as Record<string, unknown>;
    encodeField(channel, "id");
    encodeField(channel, "key");
    for (const prior of Array.isArray(channel.priors) ? channel.priors : []) {
      if (prior && typeof prior === "object") {
        encodeField(prior as Record<string, unknown>, "key");
      }
    }
  }
  for (const hr of Array.isArray(jm.held_roots) ? jm.held_roots : []) {
    if (!hr || typeof hr !== "object") continue;
    const root = hr as Record<string, unknown>;
    encodeField(root, "key");
    encodeField(root, "refounder");
    encodeField(root, "control_pk");
  }
}

/**
 * Serialize a List for the wire.
 *
 * Grimoire holds every named 32-byte value as hex internally (`canonical32`),
 * which is a re-SPELLING of what it read, never a re-shaping — so the writer
 * has to put back whichever spelling the target generation expects: §8 fixes
 * unpadded base64url for the fragmented kind, while the retired single-event
 * List predates that rule and is written in hex by the clients that still read
 * it. Fields this build does not know are never touched, so an unknown one
 * keeps its author's encoding exactly as §8 requires.
 */
export function serializeCommunityList(
  list: CommunityList,
  spelling: "hex" | "base64url",
): string {
  const copy = structuredClone(list) as CommunityList;
  if (spelling === "base64url") {
    for (const entry of copy.entries) {
      encodeField(entry as unknown as Record<string, unknown>, "community_id");
      encodeMaterial(entry.seed as unknown as Record<string, unknown>);
      encodeMaterial(entry.current as unknown as Record<string, unknown>);
      for (const cut of Array.isArray(entry.channel_cuts)
        ? entry.channel_cuts
        : []) {
        if (cut && typeof cut === "object") {
          encodeField(cut as unknown as Record<string, unknown>, "id");
        }
      }
    }
    for (const tomb of copy.tombstones) {
      if (tomb && typeof tomb === "object") {
        encodeField(tomb as unknown as Record<string, unknown>, "community_id");
      }
    }
  }
  return JSON.stringify(copy);
}

// ── The Guestbook Join (CORD-02 §5) ─────────────────────────────────────────

/**
 * The tags of a Join rumor: optionally the invite's attribution, which is what
 * makes per-link usage counters possible — visible to link-holders alone,
 * since it rides inside the sealed rumor.
 */
export function joinTags(bundle: InviteBundle): string[][] {
  const creator = bundle.creator_npub;
  if (typeof creator !== "string" || !/^[0-9a-f]{64}$/i.test(creator)) {
    return [];
  }
  const label = typeof bundle.label === "string" ? bundle.label : "";
  return [["invite", creator.toLowerCase(), label]];
}

/** The Join rumor's kind and content — the verb IS the content (CORD-02 §5). */
export const JOIN_RUMOR = { kind: KIND_JOIN_LEAVE, content: "join" } as const;
