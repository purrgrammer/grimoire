import { Copy, CopyCheck } from "lucide-react";

interface CodeCopyButtonProps {
  onCopy: () => void;
  copied: boolean;
  label?: string;
  className?: string;
}

/**
 * Reusable copy button for code blocks with consistent styling
 * Designed to be absolutely positioned over code containers
 */
export function CodeCopyButton({
  onCopy,
  copied,
  label = "Copy code",
  className = "",
}: CodeCopyButtonProps) {
  return (
    <button
      onClick={onCopy}
      className={`absolute top-2 right-2 p-2 bg-background/90 hover:bg-muted border border-border rounded transition-colors ${className}`.trim()}
      aria-label={label}
    >
      {copied ? (
        <CopyCheck className="size-4 text-muted-foreground" />
      ) : (
        <Copy className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}
