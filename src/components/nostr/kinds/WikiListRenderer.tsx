import { BookOpen, Users, Server } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";
import { getRelaysFromList } from "applesauce-common/helpers/lists";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListPreview, PubkeyListFull } from "../lists";
import { RelayLink } from "../RelayLink";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 10101 Renderer - Good Wiki Authors (Feed View)
 * NIP-51 list of trusted wiki contributors
 */
export function WikiAuthorsRenderer({ event }: BaseEventProps) {
  const pubkeys = getTagValues(event, "p");

  if (pubkeys.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No trusted wiki authors
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
          <BookOpen className="size-4 text-muted-foreground" />
          <span>Wiki Authors</span>
        </ClickableEventTitle>

        <PubkeyListPreview
          pubkeys={pubkeys}
          previewLimit={3}
          label="trusted authors"
          icon={<Users className="size-4 text-muted-foreground" />}
        />
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10101 Detail View - Full wiki authors list
 */
export function WikiAuthorsDetailRenderer({ event }: { event: NostrEvent }) {
  const pubkeys = getTagValues(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Trusted Wiki Authors</span>
      </div>

      <PubkeyListFull
        pubkeys={pubkeys}
        label="Authors"
        icon={<Users className="size-5" />}
      />
    </div>
  );
}

/**
 * Kind 10102 Renderer - Good Wiki Relays (Feed View)
 * NIP-51 list of trusted wiki relays
 */
export function WikiRelaysRenderer({ event }: BaseEventProps) {
  const relays = getRelaysFromList(event, "all");

  if (relays.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No trusted wiki relays
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
          <BookOpen className="size-4 text-muted-foreground" />
          <span>Wiki Relays</span>
        </ClickableEventTitle>

        <div className="flex items-center gap-1.5 text-xs">
          <Server className="size-3.5 text-muted-foreground" />
          <span>{relays.length} trusted relays</span>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10102 Detail View - Full wiki relays list
 */
export function WikiRelaysDetailRenderer({ event }: { event: NostrEvent }) {
  const relays = getRelaysFromList(event, "all");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Trusted Wiki Relays</span>
      </div>

      {relays.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Server className="size-5" />
            <span className="font-semibold">Relays ({relays.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {relays.map((url) => (
              <RelayLink
                key={url}
                url={url}
                showInboxOutbox={false}
                className="py-0.5"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic">
          No trusted wiki relays
        </div>
      )}
    </div>
  );
}
