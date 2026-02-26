import type { NostrEvent } from "@/types/nostr";
import {
  getPlaylistTitle,
  getPlaylistTrackPointers,
  isPlaylistPublic,
  isPlaylistCollaborative,
} from "@/lib/music-helpers";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";
import type { BaseEventProps } from "./BaseEventRenderer";
import { Label } from "@/components/ui/label";
import { UserName } from "../UserName";
import { EventRefListFull } from "../lists/EventRefList";
import { ListMusic, Music } from "lucide-react";

export function PlaylistRenderer({ event }: BaseEventProps) {
  const title = getPlaylistTitle(event);
  const tracks = getPlaylistTrackPointers(event);
  const isPublic = isPlaylistPublic(event);
  const collaborative = isPlaylistCollaborative(event);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold flex items-center gap-1.5"
        >
          <ListMusic className="size-4 text-muted-foreground flex-shrink-0" />
          {title || "Untitled Playlist"}
        </ClickableEventTitle>

        {/* Track count and badges */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <span>
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
          </span>
          {isPublic && <Label size="sm">Public</Label>}
          {collaborative && <Label size="sm">Collaborative</Label>}
        </div>
      </div>
    </BaseEventContainer>
  );
}

export function PlaylistDetailRenderer({ event }: { event: NostrEvent }) {
  const title = getPlaylistTitle(event);
  const tracks = getPlaylistTrackPointers(event);
  const isPublic = isPlaylistPublic(event);
  const collaborative = isPlaylistCollaborative(event);

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="flex-1 p-3 space-y-4">
        {/* Title */}
        <h1 className="text-2xl font-bold flex items-center gap-2 text-balance">
          <ListMusic className="size-6 text-muted-foreground flex-shrink-0" />
          {title || "Untitled Playlist"}
        </h1>

        {/* Author */}
        <UserName pubkey={event.pubkey} className="text-sm text-accent" />

        {/* Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {isPublic && <Label size="sm">Public</Label>}
          {collaborative && <Label size="sm">Collaborative</Label>}
        </div>

        {/* Track list */}
        <EventRefListFull
          addressPointers={tracks}
          label="Tracks"
          icon={<Music className="size-5 text-muted-foreground" />}
          embedded
        />
      </div>
    </div>
  );
}
