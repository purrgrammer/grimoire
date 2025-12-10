interface PlainLinkProps {
  url: string;
}

export function PlainLink({ url }: PlainLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair break-all"
    >
      {url}
    </a>
  );
}
