/**
 * Which community a bare channel id belongs to.
 *
 * The wire bus rings with a channel and nothing else — `c2:<channelIdHex>` — but
 * every store query needs the community too, and `concordRumors` has no
 * bare-channel index. For the channel a viewer has open that gap is free: the
 * component already knows both halves. For a channel of a community nobody is
 * looking at — which is the only interesting case for a notification — there is
 * nothing on screen to ask.
 *
 * So this is the resolver: every channel of every community this account has
 * mirrored, keyed by channel id, built from the MATERIALIZED fold
 * (`readStoredState`) so it costs Dexie reads and no network at all.
 *
 * It carries the fold's banlist along with the names, because a notification
 * for a message the timeline hides is worse than a badge for one — the reader
 * is pulled to a channel to find nothing there.
 */

// A cycle: `concord-communities` imports `invalidateChannelDirectory` back out
// of this file for its logout wipe. Safe because both sides of it are hoisted
// `export function` declarations and neither is called while a module is still
// evaluating — but a `const` arrow or a call at module scope on either side
// would make one of them `undefined` at init, which in this repo has shipped
// green before. Keep both ends functions, and keep both ends lazy.
import { loadStoredCommunities } from "@/services/concord-communities";
import { readStoredState } from "@/services/concord-state";

/** One channel, and what a notification needs to say about it. */
export interface ChannelDirectoryEntry {
  communityId: string;
  communityName: string;
  channelIdHex: string;
  channelName: string;
  isPrivate: boolean;
  /** The community's banned authors, whose messages the fold drops. */
  banned: ReadonlySet<string>;
}

type Directory = Map<string, ChannelDirectoryEntry>;

/** The built directory, per account. Rebuilt on demand, never on a timer. */
let memo: { pubkey: string; directory: Directory } | undefined;
/** In-flight build, so a burst of rings does not fold the vault N times. */
let building: { pubkey: string; work: Promise<Directory> } | undefined;
/**
 * Channel ids already looked for and not found since the last invalidation.
 *
 * Without this, a ring naming a channel this account cannot see — another
 * client's, or one whose fold has not landed — would rebuild the whole
 * directory on every repeat.
 */
const missed = new Set<string>();

async function build(pubkey: string): Promise<Directory> {
  const directory: Directory = new Map();
  const communities = await loadStoredCommunities(pubkey).catch(() => []);
  for (const community of communities) {
    const state = await readStoredState(community).catch(() => undefined);
    if (!state) continue;
    const communityName = state.folded.metadata?.name ?? community.name;
    for (const channel of state.channels) {
      directory.set(channel.idHex.toLowerCase(), {
        communityId: community.idHex,
        communityName,
        channelIdHex: channel.idHex.toLowerCase(),
        channelName: channel.name,
        isPrivate: channel.isPrivate,
        banned: state.folded.banned,
      });
    }
  }
  return directory;
}

/**
 * Every channel this account can see, by lowercase channel id.
 *
 * Memoized per account: the fold behind it only changes when a control edition
 * lands, and {@link invalidateChannelDirectory} is what says so.
 */
export async function channelDirectory(pubkey: string): Promise<Directory> {
  if (!pubkey) return new Map();
  if (memo?.pubkey === pubkey) return memo.directory;
  if (building?.pubkey === pubkey) return building.work;

  const work = build(pubkey).then((directory) => {
    memo = { pubkey, directory };
    missed.clear();
    building = undefined;
    return directory;
  });
  building = { pubkey, work };
  return work.catch((error) => {
    building = undefined;
    console.warn("[concord] could not build the channel directory:", error);
    return new Map<string, ChannelDirectoryEntry>();
  });
}

/**
 * One channel by id, rebuilding ONCE if this id has not been looked for yet.
 *
 * The rebuild is what makes a channel created since the directory was built
 * resolvable without waiting for a control ring; the `missed` set is what stops
 * an id that genuinely belongs to nobody here from rebuilding on every ring.
 */
export async function resolveChannel(
  pubkey: string,
  channelIdHex: string,
): Promise<ChannelDirectoryEntry | undefined> {
  const id = channelIdHex.toLowerCase();
  if (!pubkey || !id) return undefined;
  const hit = (await channelDirectory(pubkey)).get(id);
  if (hit) return hit;
  if (missed.has(id)) return undefined;
  memo = undefined;
  const rebuilt = (await channelDirectory(pubkey)).get(id);
  // Marked AFTER the rebuild: a successful build clears this set, so marking
  // first would forget the miss and rebuild again on the very next ring.
  if (!rebuilt) missed.add(id);
  return rebuilt;
}

/**
 * Forget the directory: a control edition landed, or the account changed.
 *
 * Also the logout door — the entries hold community and channel NAMES, which
 * are decrypted metadata and must not outlive the tables they came from.
 */
export function invalidateChannelDirectory(): void {
  memo = undefined;
  building = undefined;
  missed.clear();
}
