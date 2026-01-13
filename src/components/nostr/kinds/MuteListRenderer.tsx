import { VolumeX, Users, Hash, Type, FileText } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";
import { getEventPointerFromETag } from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  PubkeyListFull,
  HashtagListFull,
  WordListFull,
  EventRefListFull,
} from "../lists";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Extract event pointers from e tags
 */
function getEventPointers(event: NostrEvent): EventPointer[] {
  const pointers: EventPointer[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "e" && tag[1]) {
      const pointer = getEventPointerFromETag(tag);
      if (pointer) {
        pointers.push(pointer);
      }
    }
  }
  return pointers;
}

/**
 * Kind 10000 Renderer - Mute List (Feed View)
 * NIP-51 list of muted pubkeys, hashtags, words, and threads
 */
export function MuteListRenderer({ event }: BaseEventProps) {
  const mutedPubkeys = getTagValues(event, "p");
  const mutedHashtags = getTagValues(event, "t");
  const mutedWords = getTagValues(event, "word");
  const mutedThreads = getEventPointers(event);

  const totalMuted =
    mutedPubkeys.length +
    mutedHashtags.length +
    mutedWords.length +
    mutedThreads.length;

  if (totalMuted === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          Empty mute list
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
          <VolumeX className="size-4 text-muted-foreground" />
          <span>Mute List</span>
        </ClickableEventTitle>

        <div className="flex flex-col gap-1.5 text-xs">
          {mutedPubkeys.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 text-muted-foreground" />
              <span>{mutedPubkeys.length} people</span>
            </div>
          )}
          {mutedHashtags.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Hash className="size-3.5 text-muted-foreground" />
              <span>{mutedHashtags.length} topics</span>
            </div>
          )}
          {mutedWords.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Type className="size-3.5 text-muted-foreground" />
              <span>{mutedWords.length} words</span>
            </div>
          )}
          {mutedThreads.length > 0 && (
            <div className="flex items-center gap-1.5">
              <FileText className="size-3.5 text-muted-foreground" />
              <span>{mutedThreads.length} threads</span>
            </div>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10000 Detail View - Full mute list
 */
export function MuteListDetailRenderer({ event }: { event: NostrEvent }) {
  const mutedPubkeys = getTagValues(event, "p");
  const mutedHashtags = getTagValues(event, "t");
  const mutedWords = getTagValues(event, "word");
  const mutedThreads = getEventPointers(event);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <VolumeX className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Mute List</span>
      </div>

      {mutedPubkeys.length > 0 && (
        <PubkeyListFull
          pubkeys={mutedPubkeys}
          label="Muted People"
          icon={<Users className="size-5" />}
        />
      )}

      {mutedHashtags.length > 0 && (
        <HashtagListFull hashtags={mutedHashtags} label="Muted Topics" />
      )}

      {mutedWords.length > 0 && <WordListFull words={mutedWords} />}

      {mutedThreads.length > 0 && (
        <EventRefListFull
          eventPointers={mutedThreads}
          label="Muted Threads"
          icon={<FileText className="size-5" />}
        />
      )}

      {mutedPubkeys.length === 0 &&
        mutedHashtags.length === 0 &&
        mutedWords.length === 0 &&
        mutedThreads.length === 0 && (
          <div className="text-sm text-muted-foreground italic">
            Empty mute list
          </div>
        )}
    </div>
  );
}
