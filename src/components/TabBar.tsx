import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { LayoutControls } from "./LayoutControls";
import { useEffect } from "react";

export function TabBar() {
  const {
    state,
    setActiveWorkspace,
    createWorkspace,
    createWorkspaceWithNumber,
  } = useGrimoire();
  const { workspaces, activeWorkspaceId } = state;

  const handleNewTab = () => {
    createWorkspace();
  };

  // Sort workspaces by number (for both rendering and keyboard shortcuts)
  const sortedWorkspaces = Object.values(workspaces).sort(
    (a, b) => a.number - b.number,
  );

  // Keyboard shortcut: Cmd+1-9 to switch (or create) workspaces by number
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd/Ctrl + number key (1-9)
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault(); // Prevent browser default (like Cmd+1 = first tab)

        const desiredNumber = Number.parseInt(e.key, 10);

        // Safety check: ensure valid workspace number (1-9)
        if (desiredNumber < 1 || desiredNumber > 9) {
          return;
        }

        // Find workspace with this number
        const targetWorkspace = sortedWorkspaces.find(
          (ws) => ws.number === desiredNumber,
        );

        if (targetWorkspace) {
          // Workspace exists - switch to it
          setActiveWorkspace(targetWorkspace.id);
        } else {
          // Workspace doesn't exist - create it and switch to it
          createWorkspaceWithNumber(desiredNumber);
          // Note: We don't need to explicitly switch - createWorkspace sets it as active
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sortedWorkspaces, setActiveWorkspace, createWorkspaceWithNumber]);

  return (
    <>
      <div className="h-8 border-t border-border bg-background flex items-center px-2 gap-1 overflow-x-auto">
        {/* Left side: Workspace tabs + new workspace button */}
        <div className="flex items-center gap-1 flex-nowrap">
          {sortedWorkspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => setActiveWorkspace(ws.id)}
              className={cn(
                "px-3 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap flex-shrink-0",
                ws.id === activeWorkspaceId
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {ws.label && ws.label.trim()
                ? `${ws.number} ${ws.label}`
                : ws.number}
            </button>
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

        {/* Spacer to push right side controls to the end */}
        <div className="flex-1" />

        {/* Right side: Layout controls */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <LayoutControls />
        </div>
      </div>
    </>
  );
}
