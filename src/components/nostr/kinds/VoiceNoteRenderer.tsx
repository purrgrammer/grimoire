import { useState, useRef, useEffect, useCallback } from "react";
import { kinds } from "nostr-tools";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { Mic, Play, Pause, Reply } from "lucide-react";
import { getNip10References } from "applesauce-core/helpers/threading";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { InlineReplySkeleton } from "@/components/ui/skeleton";
import { KindBadge } from "@/components/KindBadge";
import { Button } from "@/components/ui/button";
import { getEventDisplayTitle } from "@/lib/event-title";
import { getVoiceNoteMetadata } from "@/lib/imeta";
import type { NostrEvent } from "@/types/nostr";
import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RichText } from "../RichText";
import { cn } from "@/lib/utils";

// NIP-A0 Voice Message kinds
const VOICE_MESSAGE_KIND = 1222;
const VOICE_MESSAGE_COMMENT_KIND = 1244;

/**
 * Get audio URL from event content
 */
function getAudioUrl(event: NostrEvent): string | null {
  const content = event.content.trim();
  // Content MUST be a URL pointing to an audio file
  if (content.startsWith("http://") || content.startsWith("https://")) {
    return content;
  }
  return null;
}

/**
 * Format duration in seconds to MM:SS format
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Safe Math.max for potentially large arrays
 * Uses reduce to avoid stack overflow from spread operator
 */
function safeMax(arr: number[], defaultValue = 0): number {
  if (arr.length === 0) return defaultValue;
  return arr.reduce((max, val) => (val > max ? val : max), arr[0]);
}

/**
 * Waveform visualization component with accessibility support
 */
function WaveformVisualization({
  waveform,
  progress,
  duration,
  onSeek,
}: {
  waveform: number[];
  progress: number; // 0-1
  duration: number;
  onSeek?: (progress: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize waveform to 0-1 range using safe max
  const maxAmplitude = safeMax(waveform, 1);
  const normalizedWaveform = waveform.map((v) => v / maxAmplitude);

  // Limit to ~50 bars for display
  const targetBars = 50;
  const step = Math.max(1, Math.floor(waveform.length / targetBars));
  const displayBars: number[] = [];
  for (let i = 0; i < waveform.length; i += step) {
    const chunk = normalizedWaveform.slice(i, i + step);
    displayBars.push(safeMax(chunk, 0));
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !onSeek) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickProgress = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, clickProgress)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onSeek) return;
    const step = 0.05; // 5% step
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, progress - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(1, progress + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(1);
    }
  };

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label="Audio progress"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={progress * duration}
      aria-valuetext={`${formatDuration(progress * duration)} of ${formatDuration(duration)}`}
      className="flex items-center gap-[2px] h-8 cursor-pointer flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {displayBars.map((amplitude, i) => {
        const barProgress = i / displayBars.length;
        const isPlayed = barProgress < progress;
        return (
          <div
            key={i}
            className={cn(
              "w-1 rounded-full transition-colors",
              isPlayed ? "bg-primary" : "bg-muted-foreground/40",
            )}
            style={{
              height: `${Math.max(4, amplitude * 100)}%`,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Simple progress bar fallback with accessibility support
 */
function SimpleProgressBar({
  progress,
  duration,
  onSeek,
}: {
  progress: number;
  duration: number;
  onSeek?: (progress: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !onSeek) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickProgress = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, clickProgress)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onSeek) return;
    const step = 0.05; // 5% step
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, progress - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(1, progress + step));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(1);
    }
  };

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label="Audio progress"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={progress * duration}
      aria-valuetext={`${formatDuration(progress * duration)} of ${formatDuration(duration)}`}
      className="flex-1 h-2 bg-muted-foreground/20 rounded-full cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="h-full bg-primary rounded-full transition-all"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

/**
 * Voice note audio player component
 */
function VoiceNotePlayer({
  url,
  waveform,
  initialDuration,
}: {
  url: string;
  waveform?: number[];
  initialDuration?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(initialDuration || 0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);

  // Reset state when URL changes
  useEffect(() => {
    setError(false);
    setIsPlaying(false);
    setCurrentTime(0);
    if (initialDuration) {
      setDuration(initialDuration);
    }
  }, [url, initialDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleError = () => setError(true);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("loadedmetadata", handleDurationChange);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      // Pause audio on unmount to prevent continued playback
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("loadedmetadata", handleDurationChange);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [url]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  const handleSeek = useCallback(
    (progress: number) => {
      const audio = audioRef.current;
      // Only seek if we have a valid positive duration
      if (!audio || duration <= 0) return;
      audio.currentTime = progress * duration;
    },
    [duration],
  );

  const progress = duration > 0 ? currentTime / duration : 0;

  if (error) {
    return (
      <div className="flex items-center gap-3 p-3 border border-destructive/30 rounded-lg bg-destructive/10">
        <Mic className="w-5 h-5 text-destructive" />
        <span className="text-sm text-destructive">Failed to load audio</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline ml-auto"
        >
          Open in new tab
        </a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/20">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        crossOrigin="anonymous"
      />

      <Button
        variant="default"
        size="icon"
        onClick={togglePlayback}
        className="rounded-full w-10 h-10"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause className="w-5 h-5" />
        ) : (
          <Play className="w-5 h-5 ml-0.5" />
        )}
      </Button>

      {waveform && waveform.length > 0 ? (
        <WaveformVisualization
          waveform={waveform}
          progress={progress}
          duration={duration}
          onSeek={handleSeek}
        />
      ) : (
        <SimpleProgressBar
          progress={progress}
          duration={duration}
          onSeek={handleSeek}
        />
      )}

      <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
        {formatDuration(currentTime)}
        {duration > 0 && ` / ${formatDuration(duration)}`}
      </div>
    </div>
  );
}

/**
 * Check if event kind is a voice note type
 */
function isVoiceNoteKind(kind: number): boolean {
  return kind === VOICE_MESSAGE_KIND || kind === VOICE_MESSAGE_COMMENT_KIND;
}

/**
 * Parent event card component for reply references
 * Matches the API pattern from NoteRenderer
 */
function ParentEventCard({
  parentEvent,
  icon: Icon,
  tooltipText,
  onClickHandler,
}: {
  parentEvent: NostrEvent;
  icon: LucideIcon;
  tooltipText: string;
  onClickHandler: () => void;
}) {
  // Don't show kind badge for common note types
  const showKindBadge =
    parentEvent.kind !== kinds.ShortTextNote &&
    parentEvent.kind !== VOICE_MESSAGE_KIND;

  return (
    <div
      onClick={onClickHandler}
      className="flex items-center gap-2 p-1 bg-muted/20 text-xs hover:bg-muted/30 cursor-crosshair rounded transition-colors"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Icon className="size-3 flex-shrink-0" />
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
      {showKindBadge && <KindBadge kind={parentEvent.kind} variant="compact" />}
      <UserName
        pubkey={parentEvent.pubkey}
        className="text-accent font-semibold flex-shrink-0"
      />
      <div className="text-muted-foreground truncate line-clamp-1 min-w-0 flex-1">
        {showKindBadge ? (
          getEventDisplayTitle(parentEvent, false)
        ) : isVoiceNoteKind(parentEvent.kind) ? (
          <span className="italic">Voice note</span>
        ) : (
          <RichText
            className="truncate line-clamp-1"
            event={parentEvent}
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Renderer for Kind 1222 - Voice Message (NIP-A0)
 * Short voice messages with optional waveform visualization
 */
export function VoiceNoteRenderer({ event }: BaseEventProps) {
  const audioUrl = getAudioUrl(event);
  const { waveform, duration } = getVoiceNoteMetadata(event);

  if (!audioUrl) {
    return (
      <BaseEventContainer event={event}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mic className="w-4 h-4" />
          <span>Invalid voice note (no audio URL)</span>
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <VoiceNotePlayer
        url={audioUrl}
        waveform={waveform}
        initialDuration={duration}
      />
    </BaseEventContainer>
  );
}

/**
 * Renderer for Kind 1244 - Voice Message Reply (NIP-A0)
 * Voice message replies following NIP-22 threading
 */
export function VoiceNoteReplyRenderer({ event }: BaseEventProps) {
  const { addWindow } = useGrimoire();
  const audioUrl = getAudioUrl(event);
  const { waveform, duration } = getVoiceNoteMetadata(event);

  // Use NIP-10 threading helpers (NIP-22 follows same structure)
  const refs = getNip10References(event);
  const replyPointer = refs.reply?.e || refs.reply?.a;
  const replyEvent = useNostrEvent(replyPointer, event);

  const handleReplyClick = () => {
    if (!replyEvent || !replyPointer) return;
    addWindow(
      "open",
      { pointer: replyPointer },
      `Reply to ${replyEvent.pubkey.slice(0, 8)}...`,
    );
  };

  if (!audioUrl) {
    return (
      <BaseEventContainer event={event}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mic className="w-4 h-4" />
          <span>Invalid voice note (no audio URL)</span>
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <TooltipProvider>
        {/* Show reply reference */}
        {replyPointer && !replyEvent && (
          <InlineReplySkeleton icon={<Reply className="size-3" />} />
        )}

        {replyPointer && replyEvent && (
          <ParentEventCard
            parentEvent={replyEvent}
            icon={Reply}
            tooltipText="Replying to"
            onClickHandler={handleReplyClick}
          />
        )}
      </TooltipProvider>

      <VoiceNotePlayer
        url={audioUrl}
        waveform={waveform}
        initialDuration={duration}
      />
    </BaseEventContainer>
  );
}

// Named exports for the registry
export { VoiceNoteRenderer as Kind1222Renderer };
export { VoiceNoteReplyRenderer as Kind1244Renderer };
