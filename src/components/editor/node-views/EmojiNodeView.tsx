import { useState } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

/**
 * React node view for emoji (both unicode and custom NIP-30 emoji)
 *
 * Replaces direct DOM manipulation with a React component.
 * Renders unicode emoji as text spans and custom emoji as images with error fallback.
 */
export function EmojiNodeView({ node }: ReactNodeViewProps) {
  const { url, source, id } = node.attrs as {
    url: string | null;
    source: string | null;
    id: string;
  };
  const isUnicode = source === "unicode";
  const [imgError, setImgError] = useState(false);

  // Fallback to shortcode text
  if (imgError || (!isUnicode && !url)) {
    return (
      <NodeViewWrapper as="span" className="emoji-node" data-emoji={id || ""}>
        {`:${id}:`}
      </NodeViewWrapper>
    );
  }

  if (isUnicode && url) {
    return (
      <NodeViewWrapper as="span" className="emoji-node" data-emoji={id || ""}>
        <span className="emoji-unicode" title={`:${id}:`}>
          {url}
        </span>
      </NodeViewWrapper>
    );
  }

  // Custom emoji with image
  return (
    <NodeViewWrapper as="span" className="emoji-node" data-emoji={id || ""}>
      <img
        src={url!}
        alt={`:${id}:`}
        title={`:${id}:`}
        className="emoji-image"
        draggable={false}
        onError={() => setImgError(true)}
      />
    </NodeViewWrapper>
  );
}
