import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { X, FileIcon, Music, Film } from "lucide-react";

function formatBlobSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Rich preview component for blob attachments in the editor
 *
 * Shows full-size images and videos with remove button
 */
export function BlobAttachmentRich({ node, deleteNode }: ReactNodeViewProps) {
  const { url, mimeType, size } = node.attrs as {
    url: string;
    sha256: string;
    mimeType: string;
    size: number;
    server: string;
  };

  const isImage = mimeType?.startsWith("image/");
  const isVideo = mimeType?.startsWith("video/");
  const isAudio = mimeType?.startsWith("audio/");

  return (
    <NodeViewWrapper className="my-3 relative group">
      <div className="rounded-lg border border-border bg-background overflow-hidden">
        {isImage && url && (
          <div className="relative">
            <img
              src={url}
              alt="attachment"
              className="max-w-full h-auto"
              draggable={false}
            />
            {deleteNode && (
              <button
                onClick={deleteNode}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-background/90 hover:bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity"
                contentEditable={false}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}

        {isVideo && url && (
          <div className="relative">
            <video
              src={url}
              controls
              className="max-w-full h-auto"
              preload="metadata"
            />
            {deleteNode && (
              <button
                onClick={deleteNode}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-background/90 hover:bg-background border border-border opacity-0 group-hover:opacity-100 transition-opacity"
                contentEditable={false}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}

        {isAudio && url && (
          <div className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-lg bg-muted">
              <Music className="size-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <audio src={url} controls className="w-full" />
              <p className="text-xs text-muted-foreground mt-1">
                Audio • {formatBlobSize(size || 0)}
              </p>
            </div>
            {deleteNode && (
              <button
                onClick={deleteNode}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                contentEditable={false}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}

        {!isImage && !isVideo && !isAudio && (
          <div className="p-4 flex items-center gap-3">
            <div className="p-3 rounded-lg bg-muted">
              {isVideo ? (
                <Film className="size-6 text-muted-foreground" />
              ) : (
                <FileIcon className="size-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{url}</p>
              <p className="text-xs text-muted-foreground">
                {mimeType || "Unknown"} • {formatBlobSize(size || 0)}
              </p>
            </div>
            {deleteNode && (
              <button
                onClick={deleteNode}
                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                contentEditable={false}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
