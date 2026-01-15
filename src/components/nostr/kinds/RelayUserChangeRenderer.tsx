import { UserPlus, UserMinus } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListFull } from "../lists";
import { UserName } from "../UserName";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 8000 Renderer - Add User (Feed View)
 * NIP-43 event published when a member is added to a relay
 */
export function AddUserRenderer({ event }: BaseEventProps) {
  const pubkey = getTagValue(event, "p");

  if (!pubkey) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Invalid event (missing pubkey)
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
          <UserPlus className="size-4 text-muted-foreground" />
          <span>User Added</span>
        </ClickableEventTitle>

        <div className="text-xs">
          <UserName pubkey={pubkey} className="text-xs" />
          <span className="text-muted-foreground"> added to relay</span>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 8000 Detail View
 */
export function AddUserDetailRenderer({ event }: { event: NostrEvent }) {
  const pubkey = getTagValue(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">User Added</span>
      </div>

      {pubkey ? (
        <PubkeyListFull pubkeys={[pubkey]} label="Added Member" />
      ) : (
        <div className="text-sm text-muted-foreground italic">
          Invalid event (missing pubkey)
        </div>
      )}
    </div>
  );
}

/**
 * Kind 8001 Renderer - Remove User (Feed View)
 * NIP-43 event published when a member is removed from a relay
 */
export function RemoveUserRenderer({ event }: BaseEventProps) {
  const pubkey = getTagValue(event, "p");

  if (!pubkey) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Invalid event (missing pubkey)
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
          <UserMinus className="size-4 text-muted-foreground" />
          <span>User Removed</span>
        </ClickableEventTitle>

        <div className="text-xs">
          <UserName pubkey={pubkey} className="text-xs" />
          <span className="text-muted-foreground"> removed from relay</span>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 8001 Detail View
 */
export function RemoveUserDetailRenderer({ event }: { event: NostrEvent }) {
  const pubkey = getTagValue(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <UserMinus className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">User Removed</span>
      </div>

      {pubkey ? (
        <PubkeyListFull pubkeys={[pubkey]} label="Removed Member" />
      ) : (
        <div className="text-sm text-muted-foreground italic">
          Invalid event (missing pubkey)
        </div>
      )}
    </div>
  );
}
