import { Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { useState } from "react";

export function TabBar() {
  const { state, setActiveWorkspace, createWorkspace } = useGrimoire();
  const { workspaces, activeWorkspaceId } = state;
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(
    null,
  );

  const handleNewTab = () => {
    createWorkspace();
  };

  const handleSettingsClick = (e: React.MouseEvent, workspaceId: string) => {
    e.stopPropagation(); // Prevent workspace switch
    setSettingsWorkspaceId(workspaceId);
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
                onClick={(e) => handleSettingsClick(e, ws.id)}
                className={cn(
                  "absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                  ws.id === activeWorkspaceId
                    ? "text-primary-foreground hover:bg-primary-foreground/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                aria-label={`Settings for workspace ${ws.number}`}
              >
                <SlidersHorizontal className="h-3 w-3" />
              </button>
            </div>
          ))}
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

      {settingsWorkspaceId && (
        <WorkspaceSettings
          workspaceId={settingsWorkspaceId}
          open={settingsWorkspaceId !== null}
          onOpenChange={(open) => {
            if (!open) setSettingsWorkspaceId(null);
          }}
        />
      )}
    </>
  );
}
