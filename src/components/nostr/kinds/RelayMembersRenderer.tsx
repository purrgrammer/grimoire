import { Shield, Users } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 13534 Renderer - Relay Members (Feed View)
 * NIP-43 relay membership list
 *
 * Uses "member" tags instead of standard "p" tags:
 * ["member", "<hex-pubkey>"]
 */
export function RelayMembersRenderer({ event }: BaseEventProps) {
  const members = getTagValues(event, "member");

  if (members.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Empty membership list
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Shield className="size-4 text-muted-foreground" />
          <span>Relay Members</span>
        </ClickableEventTitle>

        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <Users className="size-3.5 text-muted-foreground" />
            <span>
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>
        </div>
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
        <Shield className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Relay Members</span>
      </div>

      {members.length > 0 ? (
        <PubkeyListFull
          pubkeys={members}
          label="Members"
          icon={<Users className="size-5" />}
        />
      ) : (
        <div className="text-sm text-muted-foreground italic">
          Empty membership list
        </div>
      )}
    </div>
  );
}
