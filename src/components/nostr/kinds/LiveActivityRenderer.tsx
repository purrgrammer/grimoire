import { useMemo, useState } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  parseLiveActivity,
  getLiveStatus,
  getLiveHost,
} from "@/lib/live-activity";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";
import { Label } from "@/components/ui/Label";
import { VideoPlayer } from "@/components/live/VideoPlayer";
import { StatusBadge } from "@/components/live/StatusBadge";
import { Users, Play, Circle, Calendar, Video } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveActivityRendererProps {
  event: NostrEvent;
}

export function LiveActivityRenderer({ event }: LiveActivityRendererProps) {
  const activity = useMemo(() => parseLiveActivity(event), [event]);
  const status = useMemo(() => getLiveStatus(event), [event]);
  const hostPubkey = useMemo(() => getLiveHost(event), [event]);
  const [showVideo, setShowVideo] = useState(false);

  const hasVideo = status === "live" && activity.streaming;
  const hasRecording = status === "ended" && activity.recording;

  return (
    <BaseEventContainer
      event={event}
      authorOverride={{ pubkey: hostPubkey, label: "Host" }}
    >
      <div className="flex flex-col gap-3">
        {/* Media Section - Image or Video */}
        <div className="relative">
          {/* Show video if live and user clicked to load */}
          {hasVideo && showVideo ? (
            <VideoPlayer url={activity.streaming!} className="rounded" />
          ) : hasRecording && showVideo ? (
            <VideoPlayer url={activity.recording!} className="rounded" />
          ) : (
            // Show image or placeholder
            <div
              className={cn(
                "relative aspect-video rounded overflow-hidden",
                hasVideo || hasRecording
                  ? "cursor-pointer hover:opacity-90"
                  : "",
              )}
              onClick={() => {
                if (hasVideo || hasRecording) setShowVideo(true);
              }}
            >
              {activity.image ? (
                <>
                  <img
                    src={activity.image}
                    alt={activity.title}
                    className="w-full h-full object-cover"
                  />
                  {/* Play button overlay for video */}
                  {(hasVideo || hasRecording) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                      <div className="bg-black/70 rounded-full p-4">
                        <Play
                          className="w-8 h-8 text-white"
                          fill="currentColor"
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-neutral-800">
                  <StatusIcon status={status} />
                </div>
              )}
            </div>
          )}

          {/* Status Badge Overlay */}
          <div className="absolute top-2 left-2">
            <StatusBadge status={status} />
          </div>

          {/* Participant Count (if live and available) */}
          {status === "live" &&
            activity.currentParticipants !== undefined &&
            activity.currentParticipants > 0 && (
              <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
                <Users className="w-3 h-3" />
                <span>{activity.currentParticipants.toLocaleString()}</span>
              </div>
            )}
        </div>

        <div className="flex flex-col gap-1">
          {/* Title */}
          <ClickableEventTitle event={event} className="text-lg font-semibold">
            {activity.title || "Untitled Live Activity"}
          </ClickableEventTitle>

          {/* Summary */}
          {activity.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {activity.summary}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {/* Hashtags */}
          {activity.hashtags
            .filter((t) => !t.includes(":"))
            .map((tag) => (
              <Label key={tag} size="sm">
                {tag}
              </Label>
            ))}
        </div>
      </div>
    </BaseEventContainer>
  );
}

function StatusIcon({ status }: { status: "live" | "planned" | "ended" }) {
  const config = {
    live: { icon: Circle, className: "text-red-600" },
    planned: { icon: Calendar, className: "text-blue-600" },
    ended: { icon: Video, className: "text-neutral-600" },
  }[status];

  const Icon = config.icon;

  return <Icon className={cn("w-12 h-12", config.className)} />;
}
