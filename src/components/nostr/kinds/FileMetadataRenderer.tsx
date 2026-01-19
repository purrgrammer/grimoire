import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { MediaEmbed } from "../MediaEmbed";
import { RichText } from "../RichText";
import {
  parseFileMetadata,
  isImageMime,
  isVideoMime,
  isAudioMime,
  formatFileSize,
} from "@/lib/imeta";
import { FileText, Download } from "lucide-react";

/**
 * Renderer for Kind 1063 - File Metadata (NIP-94)
 * Displays file metadata with appropriate preview for images, videos, and audio
 */
export function Kind1063Renderer({ event }: BaseEventProps) {
  const metadata = parseFileMetadata(event);

  // Determine file type from MIME
  const isImage = isImageMime(metadata.m);
  const isVideo = isVideoMime(metadata.m);
  const isAudio = isAudioMime(metadata.m);
  const isAPK = metadata.m === "application/vnd.android.package-archive";

  // Get additional metadata
  // For APKs, use: name tag -> content (package identifier) -> fallback
  // For others, use: name tag -> fallback
  const nameTag = event.tags.find((t) => t[0] === "name")?.[1];
  const summaryTag = event.tags.find((t) => t[0] === "summary")?.[1];

  const fileName = nameTag || (isAPK ? event.content : null) || "Unknown file";
  const summary = summaryTag || (!nameTag && !isAPK ? event.content : null);

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* File preview */}
        {metadata.url && (isImage || isVideo || isAudio) ? (
          <div>
            {isImage && (
              <MediaEmbed
                url={metadata.url}
                type="image"
                alt={metadata.alt || fileName}
                preset="preview"
                enableZoom
              />
            )}
            {isVideo && (
              <MediaEmbed
                url={metadata.url}
                type="video"
                preset="preview"
                showControls
              />
            )}
            {isAudio && (
              <MediaEmbed url={metadata.url} type="audio" showControls />
            )}
          </div>
        ) : (
          /* Non-media file preview */
          <div className="flex items-center gap-3 p-4 border border-border rounded-lg bg-muted/20">
            <FileText className="w-8 h-8 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{fileName}</p>
              {metadata.m && (
                <p className="text-xs text-muted-foreground truncate">
                  {metadata.m}
                </p>
              )}
            </div>
          </div>
        )}

        {/* File metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {metadata.m && (
            <>
              <span className="text-muted-foreground">Type</span>
              <code className="font-mono text-xs truncate">{metadata.m}</code>
            </>
          )}
          {metadata.size && (
            <>
              <span className="text-muted-foreground">Size</span>
              <span>{formatFileSize(metadata.size)}</span>
            </>
          )}
          {metadata.dim && (
            <>
              <span className="text-muted-foreground">Dimensions</span>
              <span>{metadata.dim}</span>
            </>
          )}
          {metadata.x && (
            <>
              <span className="text-muted-foreground">Hash</span>
              <code className="font-mono text-xs truncate">{metadata.x}</code>
            </>
          )}
        </div>

        {/* Description/Summary */}
        {summary && (
          <RichText
            event={{ ...event, content: summary }}
            className="text-sm"
          />
        )}

        {/* Download button */}
        {metadata.url && (
          <a
            href={metadata.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-primary border border-primary/20 rounded-lg hover:bg-primary/10 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </a>
        )}
      </div>
    </BaseEventContainer>
  );
}
