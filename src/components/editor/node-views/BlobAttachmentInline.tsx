import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { formatBlobSize } from "../utils/serialize";

/**
 * Inline badge-style node view for blob attachments (used in MentionEditor)
 *
 * Shows a compact badge with media type icon, label, and size.
 * Replaces direct DOM manipulation with a React component.
 */
export function BlobAttachmentInline({ node }: ReactNodeViewProps) {
  const { url, mimeType, size } = node.attrs as {
    url: string;
    sha256: string;
    mimeType: string | null;
    size: number | null;
    server: string | null;
  };

  const isImage = mimeType?.startsWith("image/");
  const isVideo = mimeType?.startsWith("video/");
  const isAudio = mimeType?.startsWith("audio/");

  const typeLabel = isImage
    ? "image"
    : isVideo
      ? "video"
      : isAudio
        ? "audio"
        : "file";

  return (
    <NodeViewWrapper
      as="span"
      className="blob-attachment inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 border border-border text-xs align-middle"
      contentEditable={false}
    >
      {isImage && url ? (
        <img
          src={url}
          alt="attachment"
          className="h-4 w-4 object-cover rounded"
          draggable={false}
        />
      ) : (
        <span className="text-muted-foreground">
          {isVideo ? "\uD83C\uDFAC" : isAudio ? "\uD83C\uDFB5" : "\uD83D\uDCCE"}
        </span>
      )}
      <span className="text-muted-foreground truncate max-w-[80px]">
        {typeLabel}
      </span>
      {size != null && (
        <span className="text-muted-foreground/70">{formatBlobSize(size)}</span>
      )}
    </NodeViewWrapper>
  );
}
