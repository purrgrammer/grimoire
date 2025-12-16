import { X, Palette } from "lucide-react";
import { useState } from "react";

interface WindowToolbarProps {
  onClose?: () => void;
  backgroundColor?: string;
  onBackgroundColorChange?: (color: string) => void;
}

const COLORS = [
  { label: "Default", value: undefined },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#8b5cf6" },
  { label: "Pink", value: "#ec4899" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Gray", value: "#6b7280" },
];

export function WindowToolbar({
  onClose,
  backgroundColor,
  onBackgroundColorChange,
}: WindowToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={() => setShowColorPicker(!showColorPicker)}
          title="Change window color"
        >
          <Palette className="size-4" />
        </button>

        {showColorPicker && (
          <div className="absolute right-0 top-full mt-2 bg-background border border-border rounded-lg shadow-lg p-3 z-50">
            <div className="grid grid-cols-4 gap-3">
              {COLORS.map((color) => (
                <button
                  key={color.value || "default"}
                  className="w-8 h-8 rounded border-2 flex items-center justify-center flex-shrink-0 hover:scale-110 transition-transform"
                  style={{
                    backgroundColor: color.value || "transparent",
                    borderColor:
                      backgroundColor === color.value ? "#fff" : "#ccc",
                    borderStyle: !color.value ? "dashed" : "solid",
                  }}
                  onClick={() => {
                    onBackgroundColorChange?.(color.value || "");
                    setShowColorPicker(false);
                  }}
                  title={color.label}
                >
                  {!color.value && (
                    <span className="text-xs font-bold text-muted-foreground">
                      ×
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {onClose && (
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={onClose}
          title="Close window"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
