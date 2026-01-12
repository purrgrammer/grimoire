import { WindowInstance } from "@/types/app";
import { nip19 } from "nostr-tools";

/**
 * Reconstructs the command string that would have created this window.
 * Used for windows created before commandString tracking was added.
 */
export function reconstructCommand(window: WindowInstance): string {
  const { appId, props } = window;

  try {
    switch (appId) {
      case "nip":
        return `nip ${props.number || "01"}`;

      case "kind":
        return `kind ${props.number || "1"}`;

      case "kinds":
        return "kinds";

      case "man":
        return props.cmd && props.cmd !== "help" ? `man ${props.cmd}` : "help";

      case "profile": {
        // Try to encode pubkey as npub for readability
        if (props.pubkey) {
          try {
            const npub = nip19.npubEncode(props.pubkey);
            return `profile ${npub}`;
          } catch {
            // If encoding fails, use hex
            return `profile ${props.pubkey}`;
          }
        }
        return "profile";
      }

      case "open": {
        // Handle pointer structure from parseOpenCommand
        if (!props.pointer) return "open";

        const pointer = props.pointer;

        try {
          // EventPointer (has id field)
          if ("id" in pointer) {
            const nevent = nip19.neventEncode({
              id: pointer.id,
              relays: pointer.relays,
              author: pointer.author,
              kind: pointer.kind,
            });
            return `open ${nevent}`;
          }

          // AddressPointer (has kind, pubkey, identifier)
          if ("kind" in pointer) {
            const naddr = nip19.naddrEncode({
              kind: pointer.kind,
              pubkey: pointer.pubkey,
              identifier: pointer.identifier,
              relays: pointer.relays,
            });
            return `open ${naddr}`;
          }
        } catch (error) {
          console.error("Failed to encode open command:", error);
          // Fallback to raw pointer display
          if ("id" in pointer) {
            return `open ${pointer.id}`;
          }
        }

        return "open";
      }

      case "relay":
        return props.url ? `relay ${props.url}` : "relay";

      case "conn":
        return "conn";

      case "encode":
        // Best effort reconstruction
        return props.args ? `encode ${props.args.join(" ")}` : "encode";

      case "decode":
        return props.args ? `decode ${props.args[0] || ""}` : "decode";

      case "req": {
        // Reconstruct req command from filter object
        return reconstructReqCommand(props);
      }

      case "debug":
        return "debug";

      case "chat": {
        // Reconstruct chat command from protocol and identifier
        const { protocol, identifier } = props;

        if (!identifier) {
          return "chat";
        }

        // NIP-29 relay groups: chat relay'group-id
        if (protocol === "nip-29" && identifier.type === "group") {
          const relayUrl = identifier.relays?.[0] || "";
          const groupId = identifier.value;

          if (relayUrl && groupId) {
            // Strip wss:// prefix for cleaner command
            const cleanRelay = relayUrl.replace(/^wss?:\/\//, "");
            return `chat ${cleanRelay}'${groupId}`;
          }
        }

        // NIP-53 live activities: chat naddr1...
        if (protocol === "nip-53" && identifier.type === "live-activity") {
          const { pubkey, identifier: dTag } = identifier.value || {};
          const relays = identifier.relays;

          if (pubkey && dTag) {
            try {
              const naddr = nip19.naddrEncode({
                kind: 30311,
                pubkey,
                identifier: dTag,
                relays,
              });
              return `chat ${naddr}`;
            } catch {
              // Fallback if encoding fails
            }
          }
        }

        return "chat";
      }

      default:
        return appId; // Fallback to just the command name
    }
  } catch (error) {
    console.error("Failed to reconstruct command:", error);
    return appId; // Fallback to just the command name
  }
}

/**
 * Reconstructs a req command from its filter props.
 * This is complex as req has many flags.
 */
function reconstructReqCommand(props: any): string {
  const parts = ["req"];
  const filter = props.filter || {};

  // Kinds
  if (filter.kinds && filter.kinds.length > 0) {
    parts.push("-k", filter.kinds.join(","));
  }

  // Authors (convert hex to npub if possible)
  if (filter.authors && filter.authors.length > 0) {
    const authors = filter.authors.map((hex: string) => {
      try {
        return nip19.npubEncode(hex);
      } catch {
        return hex;
      }
    });
    parts.push("-a", authors.join(","));
  }

  // Limit
  if (filter.limit) {
    parts.push("-l", filter.limit.toString());
  }

  // Event IDs (#e tag)
  if (filter["#e"] && filter["#e"].length > 0) {
    parts.push("-e", filter["#e"].join(","));
  }

  // Mentioned pubkeys (#p tag)
  if (filter["#p"] && filter["#p"].length > 0) {
    const pubkeys = filter["#p"].map((hex: string) => {
      try {
        return nip19.npubEncode(hex);
      } catch {
        return hex;
      }
    });
    parts.push("-p", pubkeys.join(","));
  }

  // Hashtags (#t tag)
  if (filter["#t"] && filter["#t"].length > 0) {
    parts.push("-t", filter["#t"].join(","));
  }

  // D-tags (#d tag)
  if (filter["#d"] && filter["#d"].length > 0) {
    parts.push("-d", filter["#d"].join(","));
  }

  // Generic tags
  for (const [key, value] of Object.entries(filter)) {
    if (
      key.startsWith("#") &&
      key.length === 2 &&
      !["#e", "#p", "#t", "#d"].includes(key)
    ) {
      const letter = key[1];
      const values = value as string[];
      if (values.length > 0) {
        parts.push("--tag", letter, values.join(","));
      }
    }
  }

  // Time ranges
  if (filter.since) {
    parts.push("--since", filter.since.toString());
  }

  if (filter.until) {
    parts.push("--until", filter.until.toString());
  }

  // Search
  if (filter.search) {
    parts.push("--search", filter.search);
  }

  // Close on EOSE
  if (props.closeOnEose) {
    parts.push("--close-on-eose");
  }

  // Relays
  if (props.relays && props.relays.length > 0) {
    parts.push(...props.relays);
  }

  return parts.join(" ");
}
