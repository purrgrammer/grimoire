import { Users } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListPreview, PubkeyListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 13534 Renderer - Relay Members (Feed View)
 * NIP-43 relay membership list using "member" tags
 */
export function RelayMembersRenderer({ event }: BaseEventProps) {
  const members = getTagValues(event, "member");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Users className="size-4 text-muted-foreground" />
          <span>Relay Members</span>
        </ClickableEventTitle>

        {members.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Empty membership list
          </div>
        ) : (
          <PubkeyListPreview
            pubkeys={members}
            previewLimit={3}
            label="members"
          />
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 13534 Detail View - Full relay membership list
 */
export function RelayMembersDetailRenderer({ event }: { event: NostrEvent }) {
  const members = getTagValues(event, "member");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <Users className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Relay Members</span>
      </div>

      {members.length > 0 ? (
        <PubkeyListFull pubkeys={members} label="Members" />
      ) : (
        <div className="text-sm text-muted-foreground italic">
          Empty membership list
        </div>
      )}
    </div>
  );
}
