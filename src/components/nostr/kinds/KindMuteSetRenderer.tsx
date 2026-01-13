import { VolumeX, Users } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getTagValues } from "@/lib/nostr-utils";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListPreview, PubkeyListFull } from "../lists";
import { KindBadge } from "@/components/KindBadge";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 30007 Renderer - Kind Mute Set (Feed View)
 * NIP-51 parameterized list for muting events of a specific kind
 * The d tag contains the kind number to mute
 */
export function KindMuteSetRenderer({ event }: BaseEventProps) {
  const kindStr = getTagValue(event, "d") || "0";
  const kindNumber = parseInt(kindStr, 10);
  const pubkeys = getTagValues(event, "p");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <VolumeX className="size-4 text-muted-foreground" />
          <span>Kind Mute</span>
        </ClickableEventTitle>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Muting kind:</span>
          <KindBadge kind={kindNumber} variant="compact" />
        </div>

        {pubkeys.length > 0 && (
          <PubkeyListPreview
            pubkeys={pubkeys}
            previewLimit={3}
            label="authors muted"
            icon={<Users className="size-4 text-muted-foreground" />}
          />
        )}

        {pubkeys.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Muting all authors for this kind
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 30007 Detail View - Full kind mute set
 */
export function KindMuteSetDetailRenderer({ event }: { event: NostrEvent }) {
  const kindStr = getTagValue(event, "d") || "0";
  const kindNumber = parseInt(kindStr, 10);
  const pubkeys = getTagValues(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <VolumeX className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Kind Mute Set</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-semibold">Target Kind</span>
        <div className="flex items-center gap-2">
          <KindBadge kind={kindNumber} showName showKindNumber />
        </div>
      </div>

      {pubkeys.length > 0 ? (
        <PubkeyListFull
          pubkeys={pubkeys}
          label="Muted Authors"
          icon={<Users className="size-5 text-muted-foreground" />}
        />
      ) : (
        <div className="text-sm text-muted-foreground">
          All authors are muted for this kind
        </div>
      )}
    </div>
  );
}
