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
        return props.cmd && props.cmd !== "help"
          ? `man ${props.cmd}`
          : "help";

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
        // Try to encode event ID as note or use hex
        if (props.id) {
          try {
            const note = nip19.noteEncode(props.id);
            return `open ${note}`;
          } catch {
            return `open ${props.id}`;
          }
        }
        // Address pointer format: kind:pubkey:d-tag
        if (props.address) {
          return `open ${props.address}`;
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

      case "feed":
        return reconstructFeedCommand(props);

      case "debug":
        return "debug";

      case "win":
        return "win";

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
    if (key.startsWith("#") && key.length === 2 && !["#e", "#p", "#t", "#d"].includes(key)) {
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

/**
 * Reconstructs a feed command from its props.
 */
function reconstructFeedCommand(props: any): string {
  // Feed command structure depends on implementation
  // This is a best-effort reconstruction
  return "feed";
}
