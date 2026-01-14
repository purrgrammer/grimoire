interface EmojiNodeProps {
  node: {
    url: string;
    code: string;
  };
}

export function Emoji({ node }: EmojiNodeProps) {
  return (
    <img
      src={node.url}
      alt={`:${node.code}:`}
      title={`:${node.code}:`}
      className="inline-block size-5 cursor-help transition-transform hover:scale-125"
    />
  );
}
