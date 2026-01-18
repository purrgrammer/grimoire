import { MessageCircle, Hash } from "lucide-react";
import { useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { map } from "rxjs/operators";
import { getEventPointerFromETag } from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { ChannelLink } from "../ChannelLink";
import eventStore from "@/services/event-store";
import pool from "@/services/relay-pool";
import type { NostrEvent } from "@/types/nostr";
import type { EventPointer } from "nostr-tools/nip19";

/**
 * Extract event pointers from e tags (for channel references)
 * Channels are kind 40 events
 */
function getChannelPointers(event: NostrEvent): EventPointer[] {
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
 * Kind 10005 Renderer - Public Chats List (Feed View)
 * NIP-51 list of public chat channels (kind 40)
 * Displays each channel as a clickable link with icon and name
 * Batch-loads metadata for all channels to show their names
 * Note: This is different from kind 10009 which is for NIP-29 groups
 */
export function ChannelListRenderer({ event }: BaseEventProps) {
  const channels = getChannelPointers(event);

  // Extract channel IDs and relay hints
  const channelIds = channels.map((p) => p.id);
  const relayHintsByChannel = new Map(
    channels.map((p) => [p.id, p.relays || []]),
  );

  // Batch-load kind 40 creation events for all channels
  useEffect(() => {
    if (channelIds.length === 0) return;

    console.log(
      `[ChannelListRenderer] Fetching creation events for ${channelIds.length} channels`,
    );

    // Merge all relay hints
    const allRelayHints = Array.from(
      new Set(channels.flatMap((p) => p.relays || [])),
    );

    // Subscribe to fetch kind 40 creation events
    const subscription = pool
      .subscription(
        allRelayHints.length > 0
          ? allRelayHints
          : ["wss://relay.damus.io", "wss://nos.lol"],
        [{ kinds: [40], ids: channelIds }],
        { eventStore },
      )
      .subscribe({
        next: (response: NostrEvent | string) => {
          if (typeof response === "string") {
            console.log("[ChannelListRenderer] EOSE received for kind 40");
          } else {
            console.log(
              `[ChannelListRenderer] Received kind 40: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [
    channelIds.join(","),
    channels.map((p) => p.relays?.join(",") || "").join(";"),
  ]);

  // Batch-load kind 41 metadata for all channels
  const kind40Events = use$(
    () =>
      channelIds.length > 0
        ? eventStore.timeline({ kinds: [40], ids: channelIds }).pipe(
            map((events: NostrEvent[]) => {
              const eventMap = new Map<string, NostrEvent>();
              for (const evt of events) {
                eventMap.set(evt.id, evt);
              }
              return eventMap;
            }),
          )
        : undefined,
    [channelIds.join(",")],
  );

  // Fetch kind 41 metadata for channels we have kind 40 for
  const kind40Pubkeys = kind40Events
    ? Array.from(
        new Set(
          Array.from<NostrEvent>(kind40Events.values()).map((e) => e.pubkey),
        ),
      )
    : [];

  useEffect(() => {
    if (kind40Pubkeys.length === 0 || channelIds.length === 0) return;

    console.log(
      `[ChannelListRenderer] Fetching metadata for ${channelIds.length} channels from ${kind40Pubkeys.length} creators`,
    );

    // Merge all relay hints
    const allRelayHints = Array.from(
      new Set(channels.flatMap((p) => p.relays || [])),
    );

    // Subscribe to fetch kind 41 metadata events
    const subscription = pool
      .subscription(
        allRelayHints.length > 0
          ? allRelayHints
          : ["wss://relay.damus.io", "wss://nos.lol"],
        [{ kinds: [41], authors: kind40Pubkeys, "#e": channelIds }],
        { eventStore },
      )
      .subscribe({
        next: (response: NostrEvent | string) => {
          if (typeof response === "string") {
            console.log("[ChannelListRenderer] EOSE received for kind 41");
          } else {
            console.log(
              `[ChannelListRenderer] Received kind 41: ${response.id.slice(0, 8)}...`,
            );
          }
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, [
    kind40Pubkeys.join(","),
    channelIds.join(","),
    channels.map((p) => p.relays?.join(",") || "").join(";"),
  ]);

  if (channels.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">No channels</div>
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
          <MessageCircle className="size-4 text-muted-foreground" />
          <span>Public Channels</span>
        </ClickableEventTitle>

        <div className="flex items-center gap-1.5 text-xs">
          <Hash className="size-3.5 text-muted-foreground" />
          <span>{channels.length} channels</span>
        </div>

        <div className="flex flex-col gap-0.5">
          {channels.map((channel) => (
            <ChannelLink
              key={channel.id}
              channelId={channel.id}
              relayHints={relayHintsByChannel.get(channel.id)}
            />
          ))}
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 10005 Detail View - Full channel list
 */
export function ChannelListDetailRenderer({ event }: { event: NostrEvent }) {
  const channels = getChannelPointers(event);

  // Extract channel IDs and relay hints
  const channelIds = channels.map((p) => p.id);
  const relayHintsByChannel = new Map(
    channels.map((p) => [p.id, p.relays || []]),
  );

  // Batch-load kind 40 creation events for all channels
  useEffect(() => {
    if (channelIds.length === 0) return;

    const allRelayHints = Array.from(
      new Set(channels.flatMap((p) => p.relays || [])),
    );

    const subscription = pool
      .subscription(
        allRelayHints.length > 0
          ? allRelayHints
          : ["wss://relay.damus.io", "wss://nos.lol"],
        [{ kinds: [40], ids: channelIds }],
        { eventStore },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [
    channelIds.join(","),
    channels.map((p) => p.relays?.join(",") || "").join(";"),
  ]);

  // Batch-load kind 41 metadata for all channels
  const kind40Events = use$(
    () =>
      channelIds.length > 0
        ? eventStore.timeline({ kinds: [40], ids: channelIds }).pipe(
            map((events: NostrEvent[]) => {
              const eventMap = new Map<string, NostrEvent>();
              for (const evt of events) {
                eventMap.set(evt.id, evt);
              }
              return eventMap;
            }),
          )
        : undefined,
    [channelIds.join(",")],
  );

  const kind40Pubkeys = kind40Events
    ? Array.from(
        new Set(
          Array.from<NostrEvent>(kind40Events.values()).map((e) => e.pubkey),
        ),
      )
    : [];

  useEffect(() => {
    if (kind40Pubkeys.length === 0 || channelIds.length === 0) return;

    const allRelayHints = Array.from(
      new Set(channels.flatMap((p) => p.relays || [])),
    );

    const subscription = pool
      .subscription(
        allRelayHints.length > 0
          ? allRelayHints
          : ["wss://relay.damus.io", "wss://nos.lol"],
        [{ kinds: [41], authors: kind40Pubkeys, "#e": channelIds }],
        { eventStore },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [
    kind40Pubkeys.join(","),
    channelIds.join(","),
    channels.map((p) => p.relays?.join(",") || "").join(";"),
  ]);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-6 text-muted-foreground" />
        <span className="text-lg font-semibold">Public Channels</span>
      </div>

      {channels.length > 0 ? (
        <div className="flex flex-col gap-1">
          {channels.map((channel) => (
            <ChannelLink
              key={channel.id}
              channelId={channel.id}
              relayHints={relayHintsByChannel.get(channel.id)}
              className="p-2"
            />
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic">No channels</div>
      )}
    </div>
  );
}
