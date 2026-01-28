import { Plus, GripVertical } from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { LayoutControls } from "./LayoutControls";
import { useEffect, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Workspace } from "@/types/app";
import { useIsMobile } from "@/hooks/useIsMobile";

interface TabItemProps {
  ws: Workspace;
  isActive: boolean;
  isEditing: boolean;
  editingLabel: string;
  setEditingLabel: (label: string) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  saveLabel: () => void;
  setActiveWorkspace: (id: string) => void;
  startEditing: (id: string, label?: string) => void;
  isMobile: boolean;
}

function TabItem({
  ws,
  isActive,
  isEditing,
  editingLabel,
  setEditingLabel,
  handleKeyDown,
  saveLabel,
  setActiveWorkspace,
  startEditing,
  isMobile,
}: TabItemProps) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      key={ws.id}
      value={ws}
      dragListener={false}
      dragControls={dragControls}
      whileDrag={isMobile ? undefined : { scale: 1.05 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "flex items-center justify-center cursor-default outline-none",
      )}
    >
      {isEditing ? (
        // Render input field when editing
        <div
          className={cn(
            "px-3 py-2 md:py-1 text-sm md:text-xs font-mono rounded flex items-center gap-2 flex-shrink-0",
            isActive
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="hidden md:inline">{ws.number}</span>
          <input
            type="text"
            value={editingLabel}
            onChange={(e) => setEditingLabel(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveLabel}
            autoFocus
            style={{
              width: `${Math.max(editingLabel.length, 1)}ch`,
            }}
            className="bg-transparent border-0 outline-none focus:outline-none focus:ring-0 p-0 m-0 text-inherit"
          />
        </div>
      ) : (
        // Render button when not editing
        <div
          className={cn(
            "flex items-center gap-0 px-3 py-2 md:px-1 md:py-0.5 text-sm md:text-xs font-mono rounded transition-colors whitespace-nowrap flex-shrink-0 group",
            isActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {/* Hide drag handle on mobile - reordering disabled */}
          {!isMobile && (
            <div
              onPointerDown={(e) => dragControls.start(e)}
              className="cursor-grab active:cursor-grabbing p-1 hover:bg-black/10 rounded flex items-center justify-center"
            >
              <GripVertical className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          <button
            onClick={() => setActiveWorkspace(ws.id)}
            onDoubleClick={() => startEditing(ws.id, ws.label)}
            className="flex items-center gap-2 px-1 py-0.5 cursor-pointer"
          >
            {/* Hide workspace number on mobile - only useful for keyboard shortcuts */}
            <span className="hidden md:inline">{ws.number}</span>
            {ws.label && ws.label.trim() ? (
              <span style={{ width: `${ws.label.trim().length || 0}ch` }}>
                {ws.label.trim()}
              </span>
            ) : (
              /* Show number as fallback on mobile when no label */
              <span className="md:hidden">{ws.number}</span>
            )}
          </button>
        </div>
      )}
    </Reorder.Item>
  );
}

export function TabBar() {
  const {
    state,
    setActiveWorkspace,
    createWorkspace,
    createWorkspaceWithNumber,
    updateWorkspaceLabel,
    reorderWorkspaces,
  } = useGrimoire();
  const { workspaces, activeWorkspaceId } = state;
  const isMobile = useIsMobile();

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
      <div className="h-12 md:h-8 border-t border-border bg-background flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
        {/* Left side: Workspace tabs + new workspace button */}
        <Reorder.Group
          axis="x"
          values={sortedWorkspaces}
          onReorder={
            isMobile
              ? () => {} // No-op on mobile - reordering disabled
              : (newOrder) => reorderWorkspaces(newOrder.map((w) => w.id))
          }
          className="flex items-center gap-1 flex-nowrap list-none p-0 m-0"
        >
          {sortedWorkspaces.map((ws) => (
            <TabItem
              key={ws.id}
              ws={ws}
              isActive={ws.id === activeWorkspaceId}
              isEditing={editingId === ws.id}
              editingLabel={editingLabel}
              setEditingLabel={setEditingLabel}
              handleKeyDown={handleKeyDown}
              saveLabel={saveLabel}
              setActiveWorkspace={setActiveWorkspace}
              startEditing={startEditing}
              isMobile={isMobile}
            />
          ))}
        </Reorder.Group>

        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:h-6 md:w-6 ml-1 flex-shrink-0"
          onClick={handleNewTab}
          aria-label="Create new workspace"
        >
          <Plus className="h-5 w-5 md:h-3 md:w-3" />
        </Button>

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
