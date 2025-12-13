import { Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";

export function TabBar() {
  const { state, setActiveWorkspace, createWorkspace } = useGrimoire();
  const { workspaces, activeWorkspaceId } = state;

  const handleNewTab = () => {
    createWorkspace();
  };

  return (
    <div className="h-8 border-t border-border bg-background flex items-center px-2 gap-1 overflow-x-auto">
      <div className="flex items-center gap-1 flex-nowrap">
        {Object.values(workspaces).map((ws) => (
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
            {ws.label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 ml-1 flex-shrink-0"
          onClick={handleNewTab}
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
