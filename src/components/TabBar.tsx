import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { LayoutControls } from "./LayoutControls";
import { useEffect, useState } from "react";

export function TabBar() {
  const {
    state,
    setActiveWorkspace,
    createWorkspace,
    createWorkspaceWithNumber,
    updateWorkspaceLabel,
  } = useGrimoire();
  const { workspaces, activeWorkspaceId } = state;

  // State for inline label editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");

  const handleNewTab = () => {
    createWorkspace();
  };

  // Start editing a workspace label
  const startEditing = (workspaceId: string, currentLabel?: string) => {
    setEditingId(workspaceId);
    setEditingLabel(currentLabel || "");
  };

  // Save label changes
  const saveLabel = () => {
    if (editingId) {
      updateWorkspaceLabel(editingId, editingLabel);
      setEditingId(null);
      setEditingLabel("");
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditingLabel("");
  };

  // Handle keyboard events in input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveLabel();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
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
          {sortedWorkspaces.map((ws) => {
            const isEditing = editingId === ws.id;
            const isActive = ws.id === activeWorkspaceId;

            if (isEditing) {
              // Render input field when editing
              return (
                <div
                  key={ws.id}
                  className={cn(
                    "px-3 py-1 text-xs font-mono rounded flex items-center gap-2 flex-shrink-0",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{ws.number}</span>
                  <input
                    type="text"
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={saveLabel}
                    autoFocus
                    style={{ width: `${Math.max(editingLabel.length, 1)}ch` }}
                    className="bg-transparent border-0 outline-none focus:outline-none focus:ring-0 p-0 m-0"
                  />
                </div>
              );
            }

            // Render button when not editing
            return (
              <button
                key={ws.id}
                onClick={() => setActiveWorkspace(ws.id)}
                onDoubleClick={() => startEditing(ws.id, ws.label)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap flex-shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <span>{ws.number}</span>
                {ws.label && ws.label.trim() && (
                  <span style={{ width: `${ws.label.trim().length || 0}ch` }}>
                    {ws.label.trim()}
                  </span>
                )}
              </button>
            );
          })}

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
