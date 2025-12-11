import { X } from "lucide-react";

interface WindowToolbarProps {
  onClose?: () => void;
}

export function WindowToolbar({ onClose }: WindowToolbarProps) {
  return (
    <>
      {onClose && (
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={onClose}
          title="Close window"
        >
          <X className="size-4" />
        </button>
      )}
    </>
  );
}
