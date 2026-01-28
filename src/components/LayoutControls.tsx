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
import { Slider } from "./ui/slider";
import { useGrimoire } from "@/core/state";
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
import { useState } from "react";

export function LayoutControls() {
  const { state, applyPresetLayout, updateLayoutConfig } = useGrimoire();
  const { workspaces, activeWorkspaceId, layoutConfig } = state;

  // Local state for immediate slider feedback (debounced persistence)
  const [localSplitPercentage, setLocalSplitPercentage] = useState<
    number | null
  >(null);

  const activeWorkspace = workspaces[activeWorkspaceId];
  const windowCount = activeWorkspace?.windowIds.length || 0;
  const presets = getAllPresets();

  // Early return if no active workspace or layout config
  if (!activeWorkspace || !layoutConfig) {
    return null;
  }

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
        return <Columns2 className="h-4 w-4 text-muted-foreground" />;
      case "main-sidebar":
        return <Split className="h-4 w-4 text-muted-foreground" />;
      case "grid":
        return <Grid2X2 className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Grid2X2 className="h-4 w-4 text-muted-foreground" />;
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

  // Current split percentage (local state during drag, global state otherwise)
  const displayedSplitPercentage =
    localSplitPercentage ?? layoutConfig.splitPercentage;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:h-6 md:w-6"
          aria-label="Layout settings"
        >
          <SlidersHorizontal className="h-5 w-5 md:h-3 md:w-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Layouts Section */}
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          Layout Presets
        </div>
        {presets.map((preset) => {
          const canApply = windowCount >= preset.minSlots;

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
              </div>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        {/* Placement Section */}
        <div className="px-2 py-1.5 space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">
            Placement
          </div>
          <div className="text-xs text-muted-foreground">Window insertion</div>
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
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
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
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground">
                Split Ratio
              </span>
              <span className="text-foreground">
                {displayedSplitPercentage}/{100 - displayedSplitPercentage}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Default split for new windows
            </div>
          </div>
          <Slider
            value={[displayedSplitPercentage]}
            onValueChange={([value]) => setLocalSplitPercentage(value)}
            onValueCommit={([value]) => {
              updateLayoutConfig({ splitPercentage: value });
              setLocalSplitPercentage(null); // Clear local state after persist
            }}
            min={20}
            max={80}
            step={1}
            className="w-full"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
