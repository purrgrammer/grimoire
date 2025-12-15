import { ReactElement, useMemo } from "react";
import { WindowInstance } from "@/types/app";
import { useProfile } from "@/hooks/useProfile";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useRelayState } from "@/hooks/useRelayState";
import { getKindName, getKindIcon } from "@/constants/kinds";
import { getNipTitle } from "@/constants/nips";
import {
  getCommandIcon,
  getCommandDescription,
} from "@/constants/command-icons";
import type { EventPointer, AddressPointer } from "nostr-tools/nip19";
import type { LucideIcon } from "lucide-react";
import { nip19 } from "nostr-tools";
import { ProfileContent } from "applesauce-core/helpers";
import {
  formatEventIds,
  formatDTags,
  formatTimeRangeCompact,
  formatGenericTag,
} from "@/lib/filter-formatters";
import { getEventDisplayTitle } from "@/lib/event-title";
import { UserName } from "./nostr/UserName";

export interface WindowTitleData {
  title: string | ReactElement;
  icon?: LucideIcon;
  tooltip?: string;
}

/**
 * Format profile names with prefix
 * @param prefix - Prefix to use (e.g., 'by ', '@ ')
 * @param pubkeys - Array of pubkeys to format
 * @param profiles - Array of corresponding profile metadata
 * @returns Formatted string like "by Alice, Bob & 3 others" or null if no pubkeys
 */
function formatProfileNames(
  prefix: string,
  pubkeys: string[],
  profiles: (ProfileContent | undefined)[],
): string | null {
  if (!pubkeys.length) return null;

  const names: string[] = [];
  const [pubkey1, pubkey2] = pubkeys;
  const [profile1, profile2] = profiles;

  // Add first profile
  if (profile1) {
    const name = profile1.display_name || profile1.name;
    names.push(name || `${pubkey1.slice(0, 8)}...`);
  } else if (pubkey1) {
    names.push(`${pubkey1.slice(0, 8)}...`);
  }

  // Add second profile if exists
  if (pubkeys.length > 1) {
    if (profile2) {
      const name = profile2.display_name || profile2.name;
      names.push(name || `${pubkey2.slice(0, 8)}...`);
    } else if (pubkey2) {
      names.push(`${pubkey2.slice(0, 8)}...`);
    }
  }

  // Add "& X other(s)" if more than 2
  if (pubkeys.length > 2) {
    const othersCount = pubkeys.length - 2;
    names.push(`& ${othersCount} other${othersCount > 1 ? "s" : ""}`);
  }

  return names.length > 0 ? `${prefix}${names.join(", ")}` : null;
}

/**
 * Format hashtags with prefix
 * @param prefix - Prefix to use (e.g., '#')
 * @param hashtags - Array of hashtag strings
 * @returns Formatted string like "#bitcoin, #nostr & 2 others" or null if no hashtags
 */
function formatHashtags(prefix: string, hashtags: string[]): string | null {
  if (!hashtags.length) return null;

  const formatted: string[] = [];
  const [tag1, tag2] = hashtags;

  // Add first two hashtags
  if (tag1) formatted.push(`${prefix}${tag1}`);
  if (hashtags.length > 1 && tag2) formatted.push(`${prefix}${tag2}`);

  // Add "& X more" if more than 2
  if (hashtags.length > 2) {
    const moreCount = hashtags.length - 2;
    formatted.push(`& ${moreCount} more`);
  }

  return formatted.join(", ");
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
        if (props.filter["#t"]?.length) {
          parts.push(`-t ${props.filter["#t"].slice(0, 2).join(",")}`);
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

  // Get relay state for conn viewer
  const { relays } = useRelayState();

  // Profile titles
  const profilePubkey = appId === "profile" ? props.pubkey : null;
  const profile = useProfile(profilePubkey || "");
  const profileTitle = useMemo(() => {
    if (appId !== "profile" || !profilePubkey) return null;

    if (profile) {
      return profile.display_name || profile.name;
    }

    return `Profile ${profilePubkey.slice(0, 8)}...`;
  }, [appId, profilePubkey, profile]);

  // Event titles - use unified title extraction
  const eventPointer: EventPointer | AddressPointer | undefined =
    appId === "open" ? props.pointer : undefined;
  const event = useNostrEvent(eventPointer);
  const eventTitle = useMemo(() => {
    if (appId !== "open" || !event) return null;

    return (
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-0">
          {getKindName(event.kind)}
          <span>:</span>
        </div>
        {getEventDisplayTitle(event, false)}
        <span> - </span>
        <UserName pubkey={event.pubkey} className="text-inherit" />
      </div>
    );
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

  // Fetch profiles for REQ authors and tagged users (up to 2 each)
  const reqAuthors =
    appId === "req" && props.filter?.authors ? props.filter.authors : [];
  const [author1Pubkey, author2Pubkey] = reqAuthors;
  const author1Profile = useProfile(author1Pubkey);
  const author2Profile = useProfile(author2Pubkey);

  const reqTagged =
    appId === "req" && props.filter?.["#p"] ? props.filter["#p"] : [];
  const [tagged1Pubkey, tagged2Pubkey] = reqTagged;
  const tagged1Profile = useProfile(tagged1Pubkey);
  const tagged2Profile = useProfile(tagged2Pubkey);

  const reqHashtags =
    appId === "req" && props.filter?.["#t"] ? props.filter["#t"] : [];

  // REQ titles
  const reqTitle = useMemo(() => {
    if (appId !== "req") return null;
    const { filter } = props;

    // Generate a descriptive title from the filter
    const parts: string[] = [];

    // 1. Kinds
    if (filter.kinds && filter.kinds.length > 0) {
      const kindNames = filter.kinds.map((k: number) => getKindName(k));
      if (kindNames.length <= 3) {
        parts.push(kindNames.join(", "));
      } else {
        parts.push(
          `${kindNames.slice(0, 3).join(", ")}, +${kindNames.length - 3}`,
        );
      }
    }

    // 2. Hashtags (#t)
    if (filter["#t"] && filter["#t"].length > 0) {
      const hashtagText = formatHashtags("#", reqHashtags);
      if (hashtagText) parts.push(hashtagText);
    }

    // 3. Mentions (#p)
    if (filter["#p"] && filter["#p"].length > 0) {
      const taggedText = formatProfileNames("@", reqTagged, [
        tagged1Profile,
        tagged2Profile,
      ]);
      if (taggedText) parts.push(taggedText);
    }

    // 4. Event References (#e) - NEW
    if (filter["#e"] && filter["#e"].length > 0) {
      const eventIdsText = formatEventIds(filter["#e"], 2);
      if (eventIdsText) parts.push(`→ ${eventIdsText}`);
    }

    // 5. D-Tags (#d) - NEW
    if (filter["#d"] && filter["#d"].length > 0) {
      const dTagsText = formatDTags(filter["#d"], 2);
      if (dTagsText) parts.push(`📝 ${dTagsText}`);
    }

    // 6. Authors
    if (filter.authors && filter.authors.length > 0) {
      const authorsText = formatProfileNames("by ", reqAuthors, [
        author1Profile,
        author2Profile,
      ]);
      if (authorsText) parts.push(authorsText);
    }

    // 7. Time Range - NEW
    if (filter.since || filter.until) {
      const timeRangeText = formatTimeRangeCompact(filter.since, filter.until);
      if (timeRangeText) parts.push(`📅 ${timeRangeText}`);
    }

    // 8. Generic Tags - NEW (a-z, A-Z filters excluding e, p, t, d)
    const genericTags = Object.entries(filter)
      .filter(
        ([key]) =>
          key.startsWith("#") &&
          key.length === 2 &&
          !["#e", "#p", "#t", "#d"].includes(key),
      )
      .map(([key, values]) => ({ letter: key[1], values: values as string[] }));

    if (genericTags.length > 0) {
      genericTags.slice(0, 2).forEach((tag) => {
        const tagText = formatGenericTag(tag.letter, tag.values, 1);
        if (tagText) parts.push(tagText);
      });
      if (genericTags.length > 2) {
        parts.push(`+${genericTags.length - 2} more tags`);
      }
    }

    return parts.length > 0 ? parts.join(" • ") : "REQ";
  }, [
    appId,
    props,
    reqAuthors,
    reqTagged,
    reqHashtags,
    author1Profile,
    author2Profile,
    tagged1Profile,
    tagged2Profile,
  ]);

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

  // Conn viewer title with connection count
  const connTitle = useMemo(() => {
    if (appId !== "conn") return null;
    const relayList = Object.values(relays);
    const connectedCount = relayList.filter(
      (r) => r.connectionState === "connected",
    ).length;
    return `Relay Pool (${connectedCount}/${relayList.length})`;
  }, [appId, relays]);

  // Generate final title data with icon and tooltip
  return useMemo(() => {
    let title: ReactElement | string;
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
    } else if (kindsTitle) {
      title = kindsTitle;
      icon = getCommandIcon("kinds");
      tooltip = rawCommand;
    } else if (debugTitle) {
      title = debugTitle;
      icon = getCommandIcon("debug");
      tooltip = rawCommand;
    } else if (connTitle) {
      title = connTitle;
      icon = getCommandIcon("conn");
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
    kindsTitle,
    debugTitle,
    connTitle,
    staticTitle,
  ]);
}
