import { useMemo } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  parseLiveActivity,
  getLiveStatus,
  getLiveHost,
} from "@/lib/live-activity";
import { VideoPlayer } from "@/components/live/VideoPlayer";
import { StatusBadge } from "@/components/live/StatusBadge";
import { Label } from "@/components/ui/Label";
import { UserName } from "../UserName";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveActivityDetailRendererProps {
  event: NostrEvent;
}

export function LiveActivityDetailRenderer({
  event,
}: LiveActivityDetailRendererProps) {
  const activity = useMemo(() => parseLiveActivity(event), [event]);
  const status = useMemo(() => getLiveStatus(event), [event]);
  const hostPubkey = useMemo(() => getLiveHost(event), [event]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Video/Media Section */}
      <div className="flex-shrink-0">
        {status === "live" && activity.streaming ? (
          <VideoPlayer
            url={activity.streaming}
            autoPlay
            title={activity.title}
          />
        ) : status === "ended" && activity.recording ? (
          <VideoPlayer
            url={activity.recording}
            autoPlay
            title={activity.title}
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

      {/* Content Section */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex flex-col gap-0">
                <UserName
                  pubkey={hostPubkey}
                  className="text-lg font-semibold"
                />
                <h1 className="text-3xl font-bold mb-3">
                  {activity.title || "Untitled Live Activity"}
                </h1>
              </div>

              {activity.summary && (
                <p className="text-muted-foreground text-md">
                  {activity.summary}
                </p>
              )}
            </div>
            <StatusBadge status={status} size="md" />
          </div>

          {/* Participants with Roles */}
          {activity.participants.length > 1 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">
                Speakers & Participants
              </h2>
              <div className="grid gap-2">
                {activity.participants.map((participant) => (
                  <div
                    key={participant.pubkey}
                    className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex-1">
                      <UserName
                        pubkey={participant.pubkey}
                        className="font-medium"
                      />
                    </div>
                    <ParticipantRoleBadge role={participant.role} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hashtags */}
          {activity.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activity.hashtags
                .filter((t) => !t.startsWith("internal:"))
                .map((tag) => (
                  <Label key={tag} size="md">
                    {tag}
                  </Label>
                ))}
            </div>
          )}

          {/* Relays */}
          {activity.relays.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Relays</h2>
              <div className="space-y-1">
                {activity.relays.map((relay) => (
                  <div
                    key={relay}
                    className="text-xs font-mono text-muted-foreground bg-muted/50 px-3 py-2 rounded"
                  >
                    {relay}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Participant Role Badge
function ParticipantRoleBadge({ role }: { role: string }) {
  const roleColors: Record<string, string> = {
    Host: "bg-purple-600 text-white",
    Speaker: "bg-blue-600 text-white",
    Moderator: "bg-green-600 text-white",
    Participant: "bg-neutral-600 text-white",
  };

  const className = roleColors[role] || roleColors.Participant;

  return (
    <div
      className={cn(
        "px-2 py-1 rounded text-xs font-semibold flex-shrink-0",
        className,
      )}
    >
      {role}
    </div>
  );
}
