import { useMemo } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  parseLiveActivity,
  getLiveStatus,
  getLiveHost,
} from "@/lib/live-activity";
import { VideoPlayer } from "@/components/live/VideoPlayer";
import { StatusBadge } from "@/components/live/StatusBadge";
import { UserName } from "../UserName";
import { Label } from "@/components/ui/Label";
import { Calendar } from "lucide-react";

interface LiveActivityDetailRendererProps {
  event: NostrEvent;
}

export function LiveActivityDetailRenderer({
  event,
}: LiveActivityDetailRendererProps) {
  const activity = useMemo(() => parseLiveActivity(event), [event]);
  const status = useMemo(() => getLiveStatus(event), [event]);
  const hostPubkey = useMemo(() => getLiveHost(event), [event]);

  const videoUrl =
    status === "live" && activity.streaming
      ? activity.streaming
      : status === "ended" && activity.recording
        ? activity.recording
        : null;

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
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
              <StatusBadge status={status} />
              <p className="mt-4">No stream available</p>
            </div>
          </div>
        )}
      </div>

      {/* Stream Info Section */}
      <div className="flex-1 p-2 space-y-3">
        {/* Title and Status Badge */}
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-balance">
            {activity.title || "Untitled Live Activity"}
          </h1>
          <StatusBadge status={status} />
        </div>

        {/* Host */}
        <UserName
          pubkey={hostPubkey}
          className="text-sm text-accent"
        />

        {/* Description */}
        {activity.summary && (
          <p className="text-base text-muted-foreground leading-relaxed">
            {activity.summary}
          </p>
        )}

        {/* Hashtags */}
        {activity.hashtags.filter((t) => !t.includes(":")).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {activity.hashtags
              .filter((t) => !t.includes(":"))
              .map((tag) => (
                <Label key={tag} size="sm">
                  {tag}
                </Label>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
