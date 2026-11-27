import { useState } from "react";
import { cn } from "@/lib/utils";
import type { EmojiOnlyTier } from "@/lib/emoji-only";
import { useEmojiOnly } from "./emoji-only-context";

interface EmojiNodeProps {
  node: {
    url: string;
    code: string;
  };
}

/**
 * Image box per emoji-only tier, sized to sit beside native emoji at the body's
 * enlarged font size. A fixed square with `object-contain`, so a wide or tall
 * image is bounded instead of stretching the line.
 */
const emojiOnlySizes: Record<EmojiOnlyTier, string> = {
  single: "size-12 object-contain align-text-bottom",
  multi: "size-8 object-contain align-text-bottom",
};

export function Emoji({ node }: EmojiNodeProps) {
  const { tier, onImageError } = useEmojiOnly();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // An image that did not load falls back to the shortcode the author typed:
  // a broken-image box says nothing, and the alt text inside it is clipped.
  if (failedUrl === node.url) {
    return (
      <span title={`:${node.code}:`} className="text-muted-foreground">
        :{node.code}:
      </span>
    );
  }

  return (
    <img
      src={node.url}
      alt={`:${node.code}:`}
      title={`:${node.code}:`}
      className={cn("inline-block", tier ? emojiOnlySizes[tier] : "size-5")}
      onError={() => {
        setFailedUrl(node.url);
        onImageError();
      }}
    />
  );
}
