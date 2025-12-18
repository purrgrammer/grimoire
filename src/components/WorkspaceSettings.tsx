import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useGrimoire } from "@/core/state";
import type { LayoutConfig } from "@/types/app";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  SplitSquareHorizontal,
  SplitSquareVertical,
} from "lucide-react";

interface WorkspaceSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function WorkspaceSettings({
  open,
  onOpenChange,
  children,
}: WorkspaceSettingsProps) {
  const { state, updateLayoutConfig } = useGrimoire();
  const config = state.layoutConfig;

  // Early return if no config available
  if (!config) {
    return null;
  }

  const setInsertionMode = (mode: LayoutConfig["insertionMode"]) => {
    updateLayoutConfig({ insertionMode: mode });
  };

  const setSplitPercentage = (value: number) => {
    updateLayoutConfig({ splitPercentage: value });
  };

  const modes: Array<{
    id: LayoutConfig["insertionMode"];
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "smart", label: "Balanced", icon: Sparkles },
    { id: "row", label: "Horizontal", icon: SplitSquareHorizontal },
    { id: "column", label: "Vertical", icon: SplitSquareVertical },
  ];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3 space-y-3">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Insert Mode
          </div>
          <div className="space-y-1">
            {modes.map((mode) => {
              const Icon = mode.icon;
              const isActive = config.insertionMode === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => setInsertionMode(mode.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">Split</span>
            <span className="text-foreground">
              {config.splitPercentage}/{100 - config.splitPercentage}
            </span>
          </div>
          <input
            type="range"
            min="20"
            max="80"
            value={config.splitPercentage}
            onChange={(e) => setSplitPercentage(Number(e.target.value))}
            className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
