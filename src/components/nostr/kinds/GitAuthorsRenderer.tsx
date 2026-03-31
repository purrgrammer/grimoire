import { FileCode, Users } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { PubkeyListPreview, PubkeyListFull } from "../lists";
import type { NostrEvent } from "@/types/nostr";

/**
 * Kind 10017 Renderer - Git Authors (Feed View)
 * Follow list of people who produce NIP-34 code events
 */
export function GitAuthorsRenderer({ event }: BaseEventProps) {
  const pubkeys = getTagValues(event, "p");

  if (pubkeys.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No git authors followed
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
          <FileCode className="size-4 text-muted-foreground" />
          <span>Git Authors</span>
        </ClickableEventTitle>

        <PubkeyListPreview
          pubkeys={pubkeys}
          previewLimit={3}
          label="authors"
          icon={<Users className="size-4 text-muted-foreground" />}
        />
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10017 Detail View - Full git authors list
 */
export function GitAuthorsDetailRenderer({ event }: { event: NostrEvent }) {
  const pubkeys = getTagValues(event, "p");

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <FileCode className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Git Authors</span>
      </div>

      <PubkeyListFull
        pubkeys={pubkeys}
        label="Authors"
        icon={<Users className="size-5" />}
      />
    </div>
  );
}
