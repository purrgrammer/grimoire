import type { NostrEvent } from "@/types/nostr";
import { getTagValues } from "@/lib/nostr-utils";
import { getTagValue } from "applesauce-core/helpers";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";
import { useGrimoire } from "@/core/state";
import { MessageSquare, Server } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";

interface CommunikeyRendererProps {
  event: NostrEvent;
}

/**
 * Renderer for Communikey Community Definition events (kind 10222)
 * Displays community info, content sections, and links to chat
 */
export function CommunikeyRenderer({ event }: CommunikeyRendererProps) {
  const { addWindow } = useGrimoire();

  // Get community pubkey (the event author)
  const communityPubkey = event.pubkey;

  // Fetch community profile for name/picture
  const profile = useProfile(communityPubkey);

  // Extract community metadata from kind 10222
  const descriptionOverride = getTagValue(event, "description");
  const relays = getTagValues(event, "r").filter((url) => url);

  // Use profile metadata or fallback
  const name = profile?.name || communityPubkey.slice(0, 8);
  const about = descriptionOverride || profile?.about;

  // Parse content sections (groups of tags between "content" tags)
  const contentTags = event.tags.filter((t) => t[0] === "content");
  const contentSections = contentTags.map((t) => t[1]).filter((s) => s);

  const handleOpenChat = () => {
    if (!relays.length) return;

    // Open chat with Communikey protocol
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
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-1">
        <ClickableEventTitle event={event} className="font-semibold">
          {name}
        </ClickableEventTitle>

        {about && (
          <p className="text-xs text-muted-foreground line-clamp-2">{about}</p>
        )}

        {contentSections.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {contentSections.map((section, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 bg-muted rounded border border-border"
              >
                {section}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-1">
          {canOpenChat && (
            <button
              onClick={handleOpenChat}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <MessageSquare className="size-3" />
              Open Chat
            </button>
          )}

          {relays.length > 0 && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Server className="size-3" />
              {relays.length} relay{relays.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
