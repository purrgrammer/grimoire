import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { ExternalLink } from "lucide-react";

interface VideoPlayerProps {
  url: string;
  autoPlay?: boolean;
  title?: string;
  className?: string;
}

export function VideoPlayer({
  url,
  autoPlay = false,
  title,
  className = "",
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const isMountedRef = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);

  // Effect 1: Setup video player (only depends on url)
  useEffect(() => {
    if (!videoRef.current || !url) return;

    isMountedRef.current = true;
    const video = videoRef.current;

    // Reset state
    if (isMountedRef.current) {
      setError(null);
      setIsLoading(true);
      setIsReady(false);
    }

    // Detect HLS format
    const isHLSFormat =
      url.includes(".m3u8") || url.includes("application/x-mpegURL");

    // Named event handlers for proper cleanup
    const handleLoadedData = () => {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsReady(true);
      }
    };

    const handleVideoError = () => {
      if (isMountedRef.current) {
        setError("Failed to load video");
        setIsLoading(false);
      }
    };

    if (isHLSFormat) {
      // Check for native HLS support (Safari)
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.addEventListener("loadeddata", handleLoadedData);
        video.addEventListener("error", handleVideoError);
      }
      // Use hls.js for browsers without native support
      else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
        });

        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isMountedRef.current) {
            setIsLoading(false);
            setIsReady(true);
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.error("HLS error:", data);
          if (data.fatal && isMountedRef.current) {
            setError(`Stream error: ${data.type}`);
            setIsLoading(false);
          }
        });

        hlsRef.current = hls;
      } else {
        setError("HLS streaming not supported");
        setIsLoading(false);
      }
    } else {
      // Direct video URL
      video.src = url;
      video.addEventListener("loadeddata", handleLoadedData);
      video.addEventListener("error", handleVideoError);
    }

    // Cleanup
    return () => {
      isMountedRef.current = false;

      // Remove event listeners
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleVideoError);

      // Cleanup HLS
      if (hlsRef.current) {
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Clear video source
      video.src = "";
      video.load();
    };
  }, [url]);

  // Effect 2: Handle autoplay (separate from player setup)
  useEffect(() => {
    if (!videoRef.current || !autoPlay || !isReady || isLoading) return;

    const video = videoRef.current;

    video.play().catch((err) => {
      console.error("Autoplay failed:", err);
      if (isMountedRef.current) {
        setError("Click to play");
      }
    });
  }, [autoPlay, isReady, isLoading]);

  return (
    <div className={`video-player relative bg-black ${className}`}>
      <video
        ref={videoRef}
        className="w-full aspect-video"
        controls
        playsInline
        title={title}
      />

      {/* Loading State */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-center">
            <div className="animate-spin text-2xl mb-2">⏳</div>
            <p className="text-sm">Loading stream...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white p-4">
          <p className="text-xl mb-2">⚠️</p>
          <p className="text-center text-sm mb-4">{error}</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors"
          >
            <ExternalLink className="size-4" />
            Open in new tab
          </a>
        </div>
      )}
    </div>
  );
}
