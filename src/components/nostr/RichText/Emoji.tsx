import { CustomEmoji } from "../CustomEmoji";

interface EmojiNodeProps {
  node: {
    url: string;
    code: string;
  };
}

export function Emoji({ node }: EmojiNodeProps) {
  return (
    <CustomEmoji
      shortcode={node.code}
      url={node.url}
      size="sm"
      showTooltip={false}
    />
  );
}
