import { Plus, SlidersHorizontal, Grid2X2, Columns2, Split } from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { getAllPresets } from "@/lib/layout-presets";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { toast } from "sonner";
import { useState } from "react";

export function TabBar() {
  const { state, setActiveWorkspace, createWorkspace, applyPresetLayout } = useGrimoire();
  const { workspaces, activeWorkspaceId } = state;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeWorkspace = workspaces[activeWorkspaceId];
  const windowCount = activeWorkspace?.windowIds.length || 0;
  const presets = getAllPresets();

  const handleNewTab = () => {
    createWorkspace();
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent workspace switch
    setSettingsOpen(true);
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    if (windowCount < preset.slots) {
      toast.error(`Not enough windows`, {
        description: `Preset "${preset.name}" requires ${preset.slots} windows, but only ${windowCount} available.`,
      });
      return;
    }

    try {
      applyPresetLayout(preset);
      toast.success(`Layout applied`, {
        description: `Applied "${preset.name}" preset to workspace ${activeWorkspace.number}`,
      });
    } catch (error) {
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

  // Sort workspaces by number
  const sortedWorkspaces = Object.values(workspaces).sort(
    (a, b) => a.number - b.number,
  );

  return (
    <>
      <div className="h-8 border-t border-border bg-background flex items-center px-2 gap-1 overflow-x-auto">
        <div className="flex items-center gap-1 flex-nowrap">
          {sortedWorkspaces.map((ws) => (
            <div key={ws.id} className="relative group flex-shrink-0">
              <button
                onClick={() => setActiveWorkspace(ws.id)}
                className={cn(
                  "px-3 py-1 pr-7 text-xs font-mono rounded transition-colors whitespace-nowrap",
                  ws.id === activeWorkspaceId
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {ws.label && ws.label.trim()
                  ? `${ws.number} ${ws.label}`
                  : ws.number}
              </button>
              <button
                onClick={(e) => handleSettingsClick(e)}
                className={cn(
                  "absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                  ws.id === activeWorkspaceId
                    ? "text-primary-foreground hover:bg-primary-foreground/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                aria-label="Layout settings"
              >
                <SlidersHorizontal className="h-3 w-3" />
              </button>
            </div>
          ))}

          {/* Layout Preset Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 ml-1 flex-shrink-0"
                aria-label="Apply layout preset"
              >
                <Grid2X2 className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Apply Layout Preset
              </div>
              {presets.map((preset) => {
                const canApply = windowCount >= preset.slots;
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
                        {canApply
                          ? `${preset.slots} windows`
                          : `Needs ${preset.slots} (have ${windowCount})`}
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-1 flex-shrink-0"
            onClick={handleNewTab}
            aria-label="Create new workspace"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <WorkspaceSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </>
  );
}
