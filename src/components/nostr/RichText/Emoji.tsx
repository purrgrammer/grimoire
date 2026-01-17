import { Emoji as EmojiComponent } from "../Emoji";

interface EmojiNodeProps {
  node: {
    url: string;
    code: string;
  };
}

/**
 * RichText emoji node renderer - renders custom emoji in parsed content
 * Note: Named export "Emoji" for RichText compatibility, uses EmojiComponent internally
 */
export function Emoji({ node }: EmojiNodeProps) {
  return (
    <EmojiComponent
      source="custom"
      value={node.url}
      shortcode={node.code}
      size="sm"
      showTooltip={false}
    />
  );
}
