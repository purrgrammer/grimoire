import { Users, Radio, MessageCircle } from "lucide-react";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getCommunikeyRelays,
  getCommunikeyContentSections,
  getCommunikeyDescription,
} from "@/lib/communikeys-helpers";
import { Badge } from "@/components/ui/badge";
import { getKindName } from "@/constants/kinds";

/**
 * Renderer for Kind 10222 - Communikey (Community Definition)
 * Displays community name from profile, relay count, and content section badges
 */
export function CommunikeyRenderer({ event }: BaseEventProps) {
  // Get community profile (kind:0 metadata)
  const profile = useProfile(event.pubkey);
  const displayName = getDisplayName(event.pubkey, profile);

  // Get community configuration from the event
  const relays = getCommunikeyRelays(event);
  const contentSections = getCommunikeyContentSections(event);
  const description = getCommunikeyDescription(event) || profile?.about;

  // Check if chat is supported (kind 9 in any section)
  const hasChat = contentSections.some((section) => section.kinds.includes(9));

  return (
    <BaseEventContainer event={event}>
      <div dir="auto" className="flex flex-col gap-3">
        {/* Community name and basic info */}
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground shrink-0" />
          <ClickableEventTitle
            event={event}
            className="text-lg font-bold text-foreground"
          >
            {displayName}
          </ClickableEventTitle>
        </div>

        {/* Description */}
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}

        {/* Stats and badges */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Relay count */}
          <Badge variant="secondary" className="gap-1">
            <Radio className="size-3" />
            {relays.length} {relays.length === 1 ? "relay" : "relays"}
          </Badge>

          {/* Chat indicator */}
          {hasChat && (
            <Badge variant="outline" className="gap-1">
              <MessageCircle className="size-3" />
              Chat
            </Badge>
          )}

          {/* Content sections as badges */}
          {contentSections.map((section) => (
            <Badge
              key={section.name}
              variant="outline"
              className="text-xs"
              title={section.kinds.map((k) => getKindName(k)).join(", ")}
            >
              {section.name}
              {section.exclusive && " (exclusive)"}
            </Badge>
          ))}
        </div>
      </div>
    </BaseEventContainer>
  );
}
