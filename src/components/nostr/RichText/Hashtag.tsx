interface HashtagNodeProps {
  node: {
    hashtag: string;
  };
}

export function Hashtag({ node }: HashtagNodeProps) {
  return <span className="text-muted-foreground">#{node.hashtag}</span>;
}
