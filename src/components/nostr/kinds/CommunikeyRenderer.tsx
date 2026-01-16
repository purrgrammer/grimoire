import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { getTagValues } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import { MessageSquare, HardDrive, Coins, Shield } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { UserName } from "@/components/nostr/UserName";

/**
 * Kind 10222 Renderer - Communikey Definition (Feed View)
 * Shows communikey info with chat link
 */
export function CommunikeyRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const profile = useProfile(event.pubkey);

  // Extract communikey configuration
  const description = getTagValue(event, "description");
  const relays = getTagValues(event, "r");
  const blossomServers = getTagValues(event, "blossom");
  const mints = getTagValues(event, "mint");

  // Get content sections
  const contentTags = event.tags.filter((t) => t[0] === "content");
  const contentSections = contentTags.map((t) => t[1]).filter(Boolean);

  // Community name from profile or pubkey
  const name =
    profile?.display_name ||
    profile?.name ||
    `Communikey ${event.pubkey.slice(0, 8)}`;

  const handleOpenChat = () => {
    try {
      addWindow("chat", {
        protocol: "communikeys",
        identifier: {
          type: "group",
          value: event.pubkey,
          relays,
        },
      });
    } catch (error) {
      console.error("Failed to open communikey chat:", error);
    }
  };

  const canOpenChat = relays.length > 0;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-1.5">
        {/* Title */}
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-primary flex-shrink-0" />
          <div className="font-semibold text-sm truncate">{name}</div>
          <span className="text-xs text-muted-foreground">
            (<UserName pubkey={event.pubkey} />)
          </span>
        </div>

        {/* Description */}
        {(description || profile?.about) && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {description || profile?.about}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {relays.length > 0 && (
            <span className="flex items-center gap-1">
              <Shield className="size-3" />
              {relays.length} relay{relays.length !== 1 ? "s" : ""}
            </span>
          )}
          {blossomServers.length > 0 && (
            <span className="flex items-center gap-1">
              <HardDrive className="size-3" />
              {blossomServers.length} blossom
            </span>
          )}
          {mints.length > 0 && (
            <span className="flex items-center gap-1">
              <Coins className="size-3" />
              {mints.length} mint{mints.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Content Sections */}
        {contentSections.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap text-xs">
            {contentSections.slice(0, 3).map((section, i) => (
              <span
                key={i}
                className="bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
              >
                {section}
              </span>
            ))}
            {contentSections.length > 3 && (
              <span className="text-muted-foreground">
                +{contentSections.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Open Chat Button */}
        {canOpenChat && (
          <button
            onClick={handleOpenChat}
            className="text-xs text-primary hover:underline flex items-center gap-1 w-fit mt-0.5"
          >
            <MessageSquare className="size-3" />
            Open Chat
          </button>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10222 Detail Renderer - Communikey Definition (Detail View)
 * Shows full communikey configuration
 */
export function CommunikeyDetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const profile = useProfile(event.pubkey);

  // Extract all configuration
  const description = getTagValue(event, "description");
  const location = getTagValue(event, "location");
  const geoHash = getTagValue(event, "g");
  const relays = getTagValues(event, "r");
  const blossomServers = getTagValues(event, "blossom");
  const mints = getTagValues(event, "mint");

  // Parse content sections with their settings
  interface ContentSection {
    name: string;
    kinds: number[];
    roles: string[];
    fee?: { amount: number; unit: string };
    exclusive: boolean;
  }

  const contentSections: ContentSection[] = [];
  let currentSection: ContentSection | null = null;

  for (const tag of event.tags) {
    if (tag[0] === "content" && tag[1]) {
      // Save previous section
      if (currentSection) {
        contentSections.push(currentSection);
      }
      // Start new section
      currentSection = {
        name: tag[1],
        kinds: [],
        roles: [],
        exclusive: false,
      };
    } else if (currentSection) {
      if (tag[0] === "k" && tag[1]) {
        const kind = parseInt(tag[1], 10);
        if (!isNaN(kind)) {
          currentSection.kinds.push(kind);
        }
      } else if (tag[0] === "role") {
        currentSection.roles.push(...tag.slice(1));
      } else if (tag[0] === "fee" && tag[1] && tag[2]) {
        currentSection.fee = {
          amount: parseInt(tag[1], 10),
          unit: tag[2],
        };
      } else if (tag[0] === "exclusive") {
        currentSection.exclusive = tag[1] === "true";
      }
    }
  }

  // Don't forget the last section
  if (currentSection) {
    contentSections.push(currentSection);
  }

  // Community name from profile or pubkey
  const name =
    profile?.display_name ||
    profile?.name ||
    `Communikey ${event.pubkey.slice(0, 8)}`;

  const handleOpenChat = () => {
    try {
      addWindow("chat", {
        protocol: "communikeys",
        identifier: {
          type: "group",
          value: event.pubkey,
          relays,
        },
      });
    } catch (error) {
      console.error("Failed to open communikey chat:", error);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Shield className="size-5 text-primary" />
          <h2 className="text-xl font-bold">{name}</h2>
        </div>
        <div className="text-sm text-muted-foreground">
          <UserName pubkey={event.pubkey} />
        </div>
      </div>

      {/* Description */}
      {(description || profile?.about) && (
        <div className="text-sm">{description || profile?.about}</div>
      )}

      {/* Location */}
      {location && (
        <div className="text-sm">
          <span className="font-medium">Location:</span> {location}
          {geoHash && (
            <span className="text-muted-foreground ml-2">({geoHash})</span>
          )}
        </div>
      )}

      {/* Relays */}
      {relays.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
            <Shield className="size-4" />
            Relays ({relays.length})
          </h3>
          <div className="space-y-1">
            {relays.map((relay, i) => (
              <div
                key={i}
                className="font-mono text-xs bg-muted rounded px-2 py-1 break-all"
              >
                {i === 0 && (
                  <span className="text-primary font-semibold mr-2">
                    [Main]
                  </span>
                )}
                {relay}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blossom Servers */}
      {blossomServers.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
            <HardDrive className="size-4" />
            Blossom Servers ({blossomServers.length})
          </h3>
          <div className="space-y-1">
            {blossomServers.map((server, i) => (
              <div
                key={i}
                className="font-mono text-xs bg-muted rounded px-2 py-1 break-all"
              >
                {server}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mints */}
      {mints.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2 flex items-center gap-2">
            <Coins className="size-4" />
            Ecash Mints ({mints.length})
          </h3>
          <div className="space-y-1">
            {mints.map((mint, i) => (
              <div
                key={i}
                className="font-mono text-xs bg-muted rounded px-2 py-1 break-all"
              >
                {mint}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content Sections */}
      {contentSections.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2">
            Content Sections ({contentSections.length})
          </h3>
          <div className="space-y-3">
            {contentSections.map((section, i) => (
              <div key={i} className="border rounded p-3 space-y-2">
                <div className="font-medium text-sm">{section.name}</div>
                {section.kinds.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Kinds:</span>{" "}
                    {section.kinds.join(", ")}
                  </div>
                )}
                {section.roles.length > 0 && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Roles:</span>{" "}
                    {section.roles.join(", ")}
                  </div>
                )}
                {section.fee && (
                  <div className="text-xs">
                    <span className="text-muted-foreground">Fee:</span>{" "}
                    {section.fee.amount} {section.fee.unit}
                  </div>
                )}
                {section.exclusive && (
                  <div className="text-xs text-amber-600">
                    ⚠ Exclusive (cannot target other communities)
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Chat Button */}
      {relays.length > 0 && (
        <button
          onClick={handleOpenChat}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded flex items-center justify-center gap-2 text-sm font-medium"
        >
          <MessageSquare className="size-4" />
          Open Chat
        </button>
      )}
    </div>
  );
}
