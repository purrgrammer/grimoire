import { Mic } from "lucide-react";

interface AudioLinkProps {
  url: string;
  onClick: () => void;
}

export function AudioLink({ url, onClick }: AudioLinkProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-baseline gap-1 text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair break-all line-clamp-1"
    >
      <Mic className="h-3 w-3 flex-shrink-0" />
      <span>{url}</span>
    </button>
  );
}
