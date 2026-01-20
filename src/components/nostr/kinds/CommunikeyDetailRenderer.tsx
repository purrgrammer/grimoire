import type { NostrEvent } from "@/types/nostr";
import { getTagValues } from "@/lib/nostr-utils";
import { getTagValue } from "applesauce-core/helpers";
import { useProfile } from "@/hooks/useProfile";
import { UserName } from "../UserName";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useGrimoire } from "@/core/state";
import {
  MessageSquare,
  Server,
  Shield,
  FileText,
  MapPin,
  Coins,
  Image as ImageIcon,
} from "lucide-react";

interface CommunikeyDetailRendererProps {
  event: NostrEvent;
}

/**
 * Detail renderer for Communikey Community Definition events (kind 10222)
 * Shows full community metadata, content sections, relays, and features
 */
export function CommunikeyDetailRenderer({
  event,
}: CommunikeyDetailRendererProps) {
  const { addWindow } = useGrimoire();

  // Get community pubkey (the event author = community admin)
  const communityPubkey = event.pubkey;

  // Fetch community profile for name/picture
  const profile = useProfile(communityPubkey);

  // Extract community metadata from kind 10222
  const descriptionOverride = getTagValue(event, "description");
  const relays = getTagValues(event, "r").filter((url) => url);
  const blossomServers = getTagValues(event, "blossom").filter((url) => url);
  const mints = getTagValues(event, "mint").filter((url) => url);
  const tosPointer = getTagValue(event, "tos");
  const location = getTagValue(event, "location");
  const geoHash = getTagValue(event, "g");

  // Use profile metadata or fallback
  const name = profile?.name || communityPubkey.slice(0, 8);
  const about = descriptionOverride || profile?.about;
  const picture = profile?.picture;

  // Parse content sections
  // Content sections are groups of tags between "content" tags
  const contentSections: Array<{
    name: string;
    kinds: number[];
    badges: string[];
  }> = [];

  let currentSection: {
    name: string;
    kinds: number[];
    badges: string[];
  } | null = null;

  for (const tag of event.tags) {
    if (tag[0] === "content" && tag[1]) {
      // Save previous section if exists
      if (currentSection) {
        contentSections.push(currentSection);
      }
      // Start new section
      currentSection = {
        name: tag[1],
        kinds: [],
        badges: [],
      };
    } else if (currentSection) {
      // Add tags to current section
      if (tag[0] === "k" && tag[1]) {
        const kind = parseInt(tag[1], 10);
        if (!isNaN(kind)) {
          currentSection.kinds.push(kind);
        }
      } else if (tag[0] === "a" && tag[1]) {
        currentSection.badges.push(tag[1]);
      }
    }
  }

  // Don't forget the last section
  if (currentSection) {
    contentSections.push(currentSection);
  }

  const handleOpenChat = () => {
    if (!relays.length) return;

    addWindow("chat", {
      protocol: "communikey",
      identifier: {
        type: "communikey",
        value: communityPubkey,
        relays,
      },
    });
  };

  const canOpenChat = relays.length > 0;

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header with picture */}
      {picture && (
        <div className="relative aspect-[3/1] flex-shrink-0">
          <img
            src={picture}
            alt={name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
        </div>
      )}

      {/* Content Section */}
      <div className="flex-1 p-4 space-y-4">
        {/* Title and Admin */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-balance">{name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="size-4" />
            <span>Admin:</span>
            <UserName pubkey={communityPubkey} className="text-accent" />
          </div>
        </div>

        {/* Description */}
        {about && (
          <p className="text-base text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {about}
          </p>
        )}

        {/* Location */}
        {location && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-4" />
            <span>{location}</span>
            {geoHash && <span className="text-xs">({geoHash})</span>}
          </div>
        )}

        {/* Content Sections */}
        {contentSections.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Content Sections</h2>
            <div className="space-y-2">
              {contentSections.map((section, i) => (
                <div
                  key={i}
                  className="p-3 border border-border rounded bg-muted/30 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{section.name}</span>
                    {section.kinds.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {section.kinds.map((kind) => (
                          <Label key={kind} size="sm">
                            kind {kind}
                          </Label>
                        ))}
                      </div>
                    )}
                  </div>
                  {section.badges.length > 0 && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <span className="font-medium">Badge requirements:</span>
                      {section.badges.map((badge, j) => (
                        <div key={j} className="font-mono text-[10px] truncate">
                          {badge}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Relays */}
        {relays.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Server className="size-4" />
              Relays
            </h2>
            <div className="space-y-1">
              {relays.map((relay, i) => (
                <div
                  key={i}
                  className="text-xs font-mono text-muted-foreground px-2 py-1 bg-muted rounded"
                >
                  {i === 0 && (
                    <span className="text-primary font-semibold mr-2">
                      [main]
                    </span>
                  )}
                  {relay}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Optional Features */}
        {(blossomServers.length > 0 || mints.length > 0) && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Features</h2>
            <div className="space-y-2">
              {blossomServers.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <ImageIcon className="size-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 space-y-1">
                    <span className="font-medium">Blossom servers:</span>
                    {blossomServers.map((server, i) => (
                      <div
                        key={i}
                        className="font-mono text-muted-foreground px-2 py-1 bg-muted rounded"
                      >
                        {server}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {mints.length > 0 && (
                <div className="flex items-start gap-2 text-xs">
                  <Coins className="size-4 mt-0.5 text-muted-foreground" />
                  <div className="flex-1 space-y-1">
                    <span className="font-medium">Cashu mints:</span>
                    {mints.map((mint, i) => (
                      <div
                        key={i}
                        className="font-mono text-muted-foreground px-2 py-1 bg-muted rounded"
                      >
                        {mint}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Terms of Service */}
        {tosPointer && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="size-4" />
            <span>Terms of service: {tosPointer.slice(0, 16)}...</span>
          </div>
        )}

        {/* Open Chat Button */}
        {canOpenChat && (
          <Button onClick={handleOpenChat} className="w-full" size="lg">
            <MessageSquare className="size-4 mr-2" />
            Open Community Chat
          </Button>
        )}
      </div>
    </div>
  );
}
