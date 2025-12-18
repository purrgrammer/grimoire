import { useMemo } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  parseLiveActivity,
  getLiveStatus,
  getLiveHost,
} from "@/lib/live-activity";
import { VideoPlayer } from "@/components/live/VideoPlayer";
import { ChatView } from "@/components/nostr/ChatView";
import { StatusBadge } from "@/components/live/StatusBadge";
import { UserName } from "../UserName";
import { Calendar } from "lucide-react";
import { useOutboxRelays } from "@/hooks/useOutboxRelays";
import { useLiveTimeline } from "@/hooks/useLiveTimeline";

interface LiveActivityDetailRendererProps {
  event: NostrEvent;
}

export function LiveActivityDetailRenderer({
  event,
}: LiveActivityDetailRendererProps) {
  const activity = useMemo(() => parseLiveActivity(event), [event]);
  const status = useMemo(() => getLiveStatus(event), [event]);
  const hostPubkey = useMemo(() => getLiveHost(event), [event]);

  // Get host's relay list for chat
  const { relays: hostRelays } = useOutboxRelays({
    authors: [hostPubkey],
  });

  // Combine stream relays + host relays for chat events
  const allRelays = useMemo(
    () => Array.from(new Set([...activity.relays, ...hostRelays])),
    [activity.relays, hostRelays],
  );

  // Fetch chat messages (kind 1311) and zaps (kind 9735) that a-tag this stream
  const timelineFilter = useMemo(
    () => ({
      kinds: [1311, 9735],
      "#a": [
        `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] || ""}`,
      ],
      limit: 100,
    }),
    [event],
  );

  const { events: chatEvents } = useLiveTimeline(
    `stream-feed-${event.id}`,
    timelineFilter,
    allRelays,
    { stream: true },
  );

  const videoUrl =
    status === "live" && activity.streaming
      ? activity.streaming
      : status === "ended" && activity.recording
        ? activity.recording
        : null;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Video Section */}
      <div className="flex-shrink-0">
        {videoUrl ? (
          <VideoPlayer
            url={videoUrl}
            title={activity.title || "Untitled Live Activity"}
          />
        ) : activity.image ? (
          <div className="relative aspect-video">
            <img
              src={activity.image}
              alt={activity.title}
              className="w-full h-full object-cover"
            />
            {status === "planned" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center text-white">
                  <Calendar className="w-16 h-16 mb-4 mx-auto text-blue-500" />
                  <p className="text-2xl font-bold">Event Not Started</p>
                  {activity.starts && (
                    <p className="text-sm mt-2 text-neutral-300">
                      Starts {new Date(activity.starts * 1000).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="aspect-video bg-neutral-800 flex items-center justify-center">
            <div className="text-center text-neutral-400">
              <StatusBadge status={status} size="md" />
              <p className="mt-4">No stream available</p>
            </div>
          </div>
        )}
      </div>

      {/* Compact title bar */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold flex-1 line-clamp-1">
          {activity.title || "Untitled Live Activity"}
        </h1>
        <UserName
          pubkey={hostPubkey}
          className="text-sm font-semibold line-clamp-1"
        />
      </div>

      {/* Chat Section */}
      <div className="flex-1 min-h-0">
        <ChatView events={chatEvents} className="h-full" />
      </div>
    </div>
  );
}
