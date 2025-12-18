import {
  SlidersHorizontal,
  Grid2X2,
  Columns2,
  Split,
  Sparkles,
  SplitSquareHorizontal,
  SplitSquareVertical,
} from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { getAllPresets } from "@/lib/layout-presets";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { toast } from "sonner";
import type { LayoutConfig } from "@/types/app";

export function LayoutControls() {
  const { state, applyPresetLayout, updateLayoutConfig } = useGrimoire();
  const { workspaces, activeWorkspaceId, layoutConfig } = state;

  const activeWorkspace = workspaces[activeWorkspaceId];
  const windowCount = activeWorkspace?.windowIds.length || 0;
  const presets = getAllPresets();

  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    if (windowCount < preset.minSlots) {
      toast.error(`Not enough windows`, {
        description: `Preset "${preset.name}" requires at least ${preset.minSlots} windows, but only ${windowCount} available.`,
      });
      return;
    }

    if (preset.maxSlots && windowCount > preset.maxSlots) {
      toast.error(`Too many windows`, {
        description: `Preset "${preset.name}" supports maximum ${preset.maxSlots} windows, but ${windowCount} available.`,
      });
      return;
    }

    try {
      // Enable animations for smooth layout transition
      document.body.classList.add("animating-layout");

      applyPresetLayout(preset);

      // Remove animation class after transition completes
      setTimeout(() => {
        document.body.classList.remove("animating-layout");
      }, 180);
    } catch (error) {
      document.body.classList.remove("animating-layout");
      toast.error(`Failed to apply layout`, {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  const getPresetIcon = (presetId: string) => {
    switch (presetId) {
      case "side-by-side":
        return <Columns2 className="h-4 w-4" />;
      case "main-sidebar":
        return <Split className="h-4 w-4" />;
      case "grid":
        return <Grid2X2 className="h-4 w-4" />;
      default:
        return <Grid2X2 className="h-4 w-4" />;
    }
  };

  const insertionModes: Array<{
    id: LayoutConfig["insertionMode"];
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "smart", label: "Balanced", icon: Sparkles },
    { id: "row", label: "Horizontal", icon: SplitSquareHorizontal },
    { id: "column", label: "Vertical", icon: SplitSquareVertical },
  ];

  const handleSplitChange = (increment: number) => {
    const newValue = Math.max(
      20,
      Math.min(80, layoutConfig.splitPercentage + increment)
    );
    updateLayoutConfig({ splitPercentage: newValue });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="Layout settings"
        >
          <SlidersHorizontal className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Presets Section */}
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          Presets
        </div>
        {presets.map((preset) => {
          const hasMin = windowCount >= preset.minSlots;
          const hasMax = !preset.maxSlots || windowCount <= preset.maxSlots;
          const canApply = hasMin && hasMax;

          let statusText = "";
          if (!hasMin) {
            statusText = `Needs ${preset.minSlots}+ (have ${windowCount})`;
          } else if (!hasMax) {
            statusText = `Max ${preset.maxSlots} (have ${windowCount})`;
          } else if (preset.maxSlots) {
            statusText = `${preset.minSlots}-${preset.maxSlots} windows`;
          } else {
            statusText = `${preset.minSlots}+ windows`;
          }

          return (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => handleApplyPreset(preset.id)}
              disabled={!canApply}
              className="flex items-center gap-3 cursor-pointer"
            >
              <div className="flex-shrink-0">{getPresetIcon(preset.id)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{preset.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {statusText}
                </div>
              </div>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {/* Insertion Mode Section */}
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          Insert Mode
        </div>
        {insertionModes.map((mode) => {
          const Icon = mode.icon;
          const isActive = layoutConfig.insertionMode === mode.id;
          return (
            <DropdownMenuItem
              key={mode.id}
              onClick={() => updateLayoutConfig({ insertionMode: mode.id })}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="flex-1">{mode.label}</span>
              {isActive && (
                <div className="h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {/* Split Ratio Section */}
        <div className="px-2 py-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-muted-foreground">Split</span>
            <span className="text-foreground">
              {layoutConfig.splitPercentage}/
              {100 - layoutConfig.splitPercentage}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => handleSplitChange(-10)}
            >
              -
            </Button>
            <input
              type="range"
              min="20"
              max="80"
              value={layoutConfig.splitPercentage}
              onChange={(e) =>
                updateLayoutConfig({
                  splitPercentage: Number(e.target.value),
                })
              }
              className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => handleSplitChange(10)}
            >
              +
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
