import type { WindowInstance } from "@/types/app";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";

/**
 * Windows that single-window routes render outside the workspace: `/run` and
 * the NIP-19 previews. Each is a real `WindowInstance`, because opening any
 * other window from such a route moves it into the workspace
 * (`useStandaloneWindow`).
 */

/**
 * The id of a standalone window, derived from its command.
 *
 * Per-command, not a constant: anything keyed by window id — a post draft —
 * is shared by every page that carries the same id, so a single `"pop-out"`
 * made two unrelated `/run` windows share one. Stable across a reload, and
 * kept when the window moves into the workspace, so that state goes with it.
 */
export function standaloneWindowId(commandString: string): string {
  return `pop-out:${commandString}`;
}

/** The URL "Pop out window" opens for a workspace window. */
export function popOutUrl(commandString: string): string {
  return `/run?${new URLSearchParams({ cmd: commandString }).toString()}`;
}

/** The window behind `/run?cmd=<commandString>`. */
export function runCommandWindow(parsed: {
  appId: WindowInstance["appId"];
  props: unknown;
  commandString: string;
  customTitle?: string;
}): WindowInstance {
  return {
    id: standaloneWindowId(parsed.commandString),
    appId: parsed.appId,
    props: parsed.props,
    customTitle: parsed.customTitle,
    commandString: parsed.commandString,
  };
}

/**
 * The window `/<npub>` shows: the `profile` command for that npub, so it is
 * the same window `/run?cmd=profile <npub>` would be.
 */
export function profilePreviewWindow(
  npub: string,
  pubkey: string,
): WindowInstance {
  const commandString = `profile ${npub}`;
  return {
    id: standaloneWindowId(commandString),
    appId: "profile",
    props: { pubkey },
    commandString,
  };
}

/**
 * The window `/<note|nevent|naddr>` shows: the `open` command for that
 * identifier, so it is the same window `/run?cmd=open <identifier>` would be.
 */
export function eventPreviewWindow(
  identifier: string,
  pointer: EventPointer | AddressPointer,
): WindowInstance {
  const commandString = `open ${identifier}`;
  return {
    id: standaloneWindowId(commandString),
    appId: "open",
    props: { pointer },
    commandString,
  };
}
