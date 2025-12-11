import { useMemo } from "react";
import { WindowInstance } from "@/types/app";
import { useProfile } from "@/hooks/useProfile";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getKindName, getKindIcon } from "@/constants/kinds";
import { getNipTitle } from "@/constants/nips";
import {
  getCommandIcon,
  getCommandDescription,
} from "@/constants/command-icons";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import type { LucideIcon } from "lucide-react";
import { nip19 } from "nostr-tools";

export interface WindowTitleData {
  title: string;
  icon?: LucideIcon;
  tooltip?: string;
}

/**
 * Generate raw command string from window appId and props
 */
function generateRawCommand(appId: string, props: any): string {
  switch (appId) {
    case "profile":
      if (props.pubkey) {
        try {
          const npub = nip19.npubEncode(props.pubkey);
          return `profile ${npub}`;
        } catch {
          return `profile ${props.pubkey.slice(0, 16)}...`;
        }
      }
      return "profile";

    case "kind":
      return props.number ? `kind ${props.number}` : "kind";

    case "nip":
      return props.number ? `nip ${props.number}` : "nip";

    case "relay":
      return props.url ? `relay ${props.url}` : "relay";

    case "open":
      if (props.pointer) {
        try {
          if ("id" in props.pointer) {
            const nevent = nip19.neventEncode({ id: props.pointer.id });
            return `open ${nevent}`;
          } else if ("kind" in props.pointer && "pubkey" in props.pointer) {
            const naddr = nip19.naddrEncode({
              kind: props.pointer.kind,
              pubkey: props.pointer.pubkey,
              identifier: props.pointer.identifier || "",
            });
            return `open ${naddr}`;
          }
        } catch {
          // Fallback to shortened ID
        }
      }
      return "open";

    case "encode":
      if (props.args && props.args[0]) {
        return `encode ${props.args[0]}`;
      }
      return "encode";

    case "decode":
      if (props.args && props.args[0]) {
        return `decode ${props.args[0]}`;
      }
      return "decode";

    case "req":
      // REQ command can be complex, show simplified version
      if (props.filter) {
        const parts: string[] = ["req"];
        if (props.filter.kinds?.length) {
          parts.push(`-k ${props.filter.kinds.join(",")}`);
        }
        if (props.filter.authors?.length) {
          parts.push(`-a ${props.filter.authors.slice(0, 2).join(",")}`);
        }
        return parts.join(" ");
      }
      return "req";

    case "man":
      return props.cmd ? `man ${props.cmd}` : "man";

    default:
      return appId;
  }
}

/**
 * useDynamicWindowTitle - Hook to generate dynamic window titles based on loaded data
 * Similar to WindowRenderer but for titles instead of content
 */
export function useDynamicWindowTitle(window: WindowInstance): WindowTitleData {
  return useDynamicTitle(window);
}

function useDynamicTitle(window: WindowInstance): WindowTitleData {
  const { appId, props, title: staticTitle } = window;

  // Profile titles
  const profilePubkey = appId === "profile" ? props.pubkey : null;
  const profile = useProfile(profilePubkey || "");
  const profileTitle = useMemo(() => {
    if (appId !== "profile" || !profilePubkey) return null;

    if (profile) {
      const displayName = profile.display_name || profile.name;
      if (displayName) {
        return `@${displayName}`;
      }
    }

    return `Profile ${profilePubkey.slice(0, 8)}...`;
  }, [appId, profilePubkey, profile]);

  // Event titles
  const eventPointer: EventPointer | AddressPointer | undefined =
    appId === "open" ? props.pointer : undefined;
  const event = useNostrEvent(eventPointer);
  const eventTitle = useMemo(() => {
    if (appId !== "open" || !event) return null;

    const kindName = getKindName(event.kind);

    // For text-based events, show a preview
    if (event.kind === 1 && event.content) {
      const preview = event.content.slice(0, 40).trim();
      return preview ? `${kindName}: ${preview}...` : kindName;
    }

    // For articles (kind 30023), show title tag
    if (event.kind === 30023) {
      const titleTag = event.tags.find((t) => t[0] === "title")?.[1];
      if (titleTag) {
        return titleTag.length > 50 ? `${titleTag.slice(0, 50)}...` : titleTag;
      }
    }

    // For highlights (kind 9802), show preview
    if (event.kind === 9802 && event.content) {
      const preview = event.content.slice(0, 40).trim();
      return preview ? `Highlight: ${preview}...` : "Highlight";
    }

    return kindName;
  }, [appId, event]);

  // Kind titles
  const kindTitle = useMemo(() => {
    if (appId !== "kind") return null;
    const kindNum = parseInt(props.number);
    return getKindName(kindNum);
  }, [appId, props]);

  // Relay titles (clean up URL)
  const relayTitle = useMemo(() => {
    if (appId !== "relay") return null;
    try {
      const url = new URL(props.url);
      return url.hostname;
    } catch {
      return props.url;
    }
  }, [appId, props]);

  // REQ titles
  const reqTitle = useMemo(() => {
    if (appId !== "req") return null;
    const { filter } = props;

    // Generate a descriptive title from the filter
    const parts: string[] = [];

    if (filter.kinds && filter.kinds.length > 0) {
      // Show actual kind names
      const kindNames = filter.kinds.map((k: number) => getKindName(k));
      if (kindNames.length <= 3) {
        parts.push(kindNames.join(", "));
      } else {
        parts.push(
          `${kindNames.slice(0, 3).join(", ")}, +${kindNames.length - 3}`,
        );
      }
    }

    if (filter.authors && filter.authors.length > 0) {
      parts.push(
        `${filter.authors.length} author${filter.authors.length > 1 ? "s" : ""}`,
      );
    }

    return parts.length > 0 ? parts.join(" • ") : "REQ";
  }, [appId, props]);

  // Encode/Decode titles
  const encodeTitle = useMemo(() => {
    if (appId !== "encode") return null;
    const { args } = props;
    if (args && args[0]) {
      return `ENCODE ${args[0].toUpperCase()}`;
    }
    return "ENCODE";
  }, [appId, props]);

  const decodeTitle = useMemo(() => {
    if (appId !== "decode") return null;
    const { args } = props;
    if (args && args[0]) {
      const prefix = args[0].match(
        /^(npub|nprofile|note|nevent|naddr|nsec)/i,
      )?.[1];
      if (prefix) {
        return `DECODE ${prefix.toUpperCase()}`;
      }
    }
    return "DECODE";
  }, [appId, props]);

  // NIP titles
  const nipTitle = useMemo(() => {
    if (appId !== "nip") return null;
    const title = getNipTitle(props.number);
    return `NIP-${props.number}: ${title}`;
  }, [appId, props]);

  // Man page titles - just show the command description, icon shows on hover
  const manTitle = useMemo(() => {
    if (appId !== "man") return null;
    // For man pages, we'll show the command's description via tooltip
    // The title can just be generic or empty, as the icon conveys meaning
    return getCommandDescription(props.cmd) || `${props.cmd} manual`;
  }, [appId, props]);

  // Feed title
  const feedTitle = useMemo(() => {
    if (appId !== "feed") return null;
    return "Feed";
  }, [appId]);

  // Win viewer title
  const winTitle = useMemo(() => {
    if (appId !== "win") return null;
    return "Windows";
  }, [appId]);

  // Kinds viewer title
  const kindsTitle = useMemo(() => {
    if (appId !== "kinds") return null;
    return "Kinds";
  }, [appId]);

  // Debug viewer title
  const debugTitle = useMemo(() => {
    if (appId !== "debug") return null;
    return "Debug";
  }, [appId]);

  // Generate final title data with icon and tooltip
  return useMemo(() => {
    let title: string;
    let icon: LucideIcon | undefined;
    let tooltip: string | undefined;

    // Generate raw command for tooltip
    const rawCommand = generateRawCommand(appId, props);

    // Priority order for title selection
    if (profileTitle) {
      title = profileTitle;
      icon = getCommandIcon("profile");
      tooltip = rawCommand;
    } else if (eventTitle && appId === "open") {
      title = eventTitle;
      // Use the event's kind icon if we have the event loaded
      if (event) {
        icon = getKindIcon(event.kind);
      } else {
        icon = getCommandIcon("open");
      }
      tooltip = rawCommand;
    } else if (kindTitle && appId === "kind") {
      title = kindTitle;
      const kindNum = parseInt(props.number);
      icon = getKindIcon(kindNum);
      tooltip = rawCommand;
    } else if (relayTitle) {
      title = relayTitle;
      icon = getCommandIcon("relay");
      tooltip = rawCommand;
    } else if (reqTitle) {
      title = reqTitle;
      icon = getCommandIcon("req");
      tooltip = rawCommand;
    } else if (encodeTitle) {
      title = encodeTitle;
      icon = getCommandIcon("encode");
      tooltip = rawCommand;
    } else if (decodeTitle) {
      title = decodeTitle;
      icon = getCommandIcon("decode");
      tooltip = rawCommand;
    } else if (nipTitle) {
      title = nipTitle;
      icon = getCommandIcon("nip");
      tooltip = rawCommand;
    } else if (manTitle) {
      title = manTitle;
      // Use the specific command's icon, not the generic "man" icon
      icon = getCommandIcon(props.cmd);
      tooltip = rawCommand;
    } else if (feedTitle) {
      title = feedTitle;
      icon = getCommandIcon("feed");
      tooltip = rawCommand;
    } else if (winTitle) {
      title = winTitle;
      icon = getCommandIcon("win");
      tooltip = rawCommand;
    } else if (kindsTitle) {
      title = kindsTitle;
      icon = getCommandIcon("kinds");
      tooltip = rawCommand;
    } else if (debugTitle) {
      title = debugTitle;
      icon = getCommandIcon("debug");
      tooltip = rawCommand;
    } else {
      title = staticTitle;
      tooltip = rawCommand;
    }

    return { title, icon, tooltip };
  }, [
    appId,
    props,
    event,
    profileTitle,
    eventTitle,
    kindTitle,
    relayTitle,
    reqTitle,
    encodeTitle,
    decodeTitle,
    nipTitle,
    manTitle,
    feedTitle,
    winTitle,
    kindsTitle,
    debugTitle,
    staticTitle,
  ]);
}
