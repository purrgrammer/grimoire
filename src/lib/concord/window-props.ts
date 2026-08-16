/**
 * Where a Concord window is: the one place its props are rewritten.
 *
 * `Logic.updateWindow` REPLACES `props` wholesale (`{ ...window, ...updates }`),
 * so every caller has to spread what was already there or silently drop it —
 * a memory test that only fails much later, when a window reopens missing a
 * flag nobody connected to navigation. Routing all three navigation write sites
 * through one helper makes that spread a property of the code rather than of
 * whoever wrote the newest call.
 *
 * The window's props are also the reload story: `grimoire_v6` persists them, so
 * what this writes is what a Concord window comes back as.
 */

/** The subset of a window this helper is allowed to move. */
export interface ConcordWindowUpdate {
  props: Record<string, unknown>;
  commandString: string;
}

/**
 * The props a Concord window should carry after navigating to this channel.
 *
 * `communityId` is written as the RESOLVED full id even when the window opened
 * on a prefix (`concord 3fa2` is a legal command), so the first navigation
 * upgrades the window to something that resolves exactly on reload.
 *
 * `channelId` is dropped rather than left stale when there is no channel to
 * name: a channel id from the community you just left resolves nowhere, and
 * carrying it into the next session only makes the fallback chain do the work
 * twice.
 */
export function buildConcordWindowUpdate(
  existingProps: Record<string, unknown> | undefined,
  communityIdHex: string,
  channelIdHex?: string,
): ConcordWindowUpdate {
  const { channelId: _stale, ...rest } = existingProps ?? {};
  return {
    props: {
      ...rest,
      communityId: communityIdHex,
      ...(channelIdHex ? { channelId: channelIdHex } : {}),
    },
    // The command has no channel argument — a channel has no user-typeable
    // address — so the reconstructed command names the community only, and the
    // channel rides in the props beside it.
    commandString: `concord ${communityIdHex}`,
  };
}
