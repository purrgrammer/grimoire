/**
 * Where a browser window is: the one place its props are rewritten.
 *
 * `Logic.updateWindow` REPLACES `props` wholesale (`{ ...window, ...updates }`),
 * so every caller has to spread what was already there or silently drop it —
 * a memory test that only fails much later, when a window reopens missing a
 * flag nobody connected to navigation. Routing all three navigation write sites
 * through one helper makes that spread a property of the code rather than of
 * whoever wrote the newest call.
 *
 * The window's props are also the reload story: `grimoire_v6` persists them, so
 * what this writes is what a browser window comes back as.
 */

/**
 * Whether a window is the chat browser: bare `chat`, which names no single
 * conversation. The same test `WindowRenderer` routes on.
 */
export function isBrowserWindow(window: {
  appId: string;
  props?: { identifier?: { type?: string } } | null;
}): boolean {
  if (window.appId !== "chat") return false;
  const identifier = window.props?.identifier;
  return !identifier || identifier.type === "browser";
}

/** The subset of a window this helper is allowed to move. */
export interface ConcordWindowUpdate {
  props: Record<string, unknown>;
  commandString: string;
}

/**
 * Everything that names a selection, so a write can drop what it replaces.
 *
 * One selection, three families — a channel, a private conversation and a
 * relay group cannot be open at once — so every write clears the other two
 * rather than leaving a window that reloads showing one while the sidebar
 * highlights another.
 */
function withoutSelection(existingProps: Record<string, unknown> | undefined) {
  const {
    channelId: _channel,
    dmPeer: _dm,
    groupId: _group,
    groupRelay: _relay,
    ...rest
  } = existingProps ?? {};
  return rest;
}

/**
 * The command a browser window reopens with: bare `chat`, always.
 *
 * Its appId dispatches on props: `chat <identifier>` is a single-conversation
 * window, so rebuilding the command with an argument would reopen the browser
 * as one pane with no sidebar at all. The selection rides in the props.
 */
const BROWSER_COMMAND = "chat";

/**
 * The props a Concord window should carry after navigating to this channel.
 *
 * `communityId` is written as the RESOLVED full id even when the window opened
 * on a prefix (`chat 3fa2` is a legal command), so the first navigation
 * upgrades the window to something that resolves exactly on reload.
 *
 * `channelId` is dropped rather than left stale when there is no channel to
 * name: a channel id from the community you just left resolves nowhere, and
 * carrying it into the next session only makes the fallback chain do the work
 * twice.
 *
 * `dmPeer` is dropped too, and for a sharper reason: a channel and a private
 * conversation are one selection with two families, so a window carrying both
 * would reload showing the DM while the sidebar highlighted a channel.
 */
export function buildConcordWindowUpdate(
  existingProps: Record<string, unknown> | undefined,
  communityIdHex: string,
  channelIdHex?: string,
): ConcordWindowUpdate {
  return {
    props: {
      ...withoutSelection(existingProps),
      communityId: communityIdHex,
      ...(channelIdHex ? { channelId: channelIdHex } : {}),
    },
    commandString: BROWSER_COMMAND,
  };
}

/**
 * The props a Concord window should carry after opening a private conversation.
 *
 * The mirror image of {@link buildConcordWindowUpdate}: the DM replaces the
 * channel rather than joining it, and `communityId` survives so closing the
 * conversation returns to the community the reader was in.
 */
export function buildConcordDmUpdate(
  existingProps: Record<string, unknown> | undefined,
  peerHex: string,
): ConcordWindowUpdate {
  const rest = withoutSelection(existingProps);
  return {
    props: { ...rest, dmPeer: peerHex },
    commandString: BROWSER_COMMAND,
  };
}

/**
 * The props a window should carry after opening a NIP-29 relay group.
 *
 * Both halves are written. A group id is only unique within the relay hosting
 * it, so a window that remembered the id alone would reopen on whichever relay
 * answered first — a different room with the same name.
 */
export function buildBrowserGroupUpdate(
  existingProps: Record<string, unknown> | undefined,
  groupId: string,
  relayUrl: string,
): ConcordWindowUpdate {
  const rest = withoutSelection(existingProps);
  return {
    props: { ...rest, groupId, groupRelay: relayUrl },
    commandString: BROWSER_COMMAND,
  };
}
