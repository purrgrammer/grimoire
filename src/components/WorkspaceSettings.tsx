import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/Label";
import { Button } from "./ui/button";
import {
  Sparkles,
  SplitSquareHorizontal,
  SplitSquareVertical,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import type { LayoutConfig } from "@/types/app";
import { cn } from "@/lib/utils";

interface WorkspaceSettingsProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceSettings({
  workspaceId,
  open,
  onOpenChange,
}: WorkspaceSettingsProps) {
  const { state, updateWorkspaceLayoutConfig } = useGrimoire();
  const workspace = state.workspaces[workspaceId];

  // Local state for settings
  const [insertionMode, setInsertionMode] = useState<LayoutConfig["insertionMode"]>(
    workspace?.layoutConfig?.insertionMode || "smart"
  );
  const [splitPercentage, setSplitPercentage] = useState(
    workspace?.layoutConfig?.splitPercentage || 50
  );
  const [insertionPosition, setInsertionPosition] = useState<LayoutConfig["insertionPosition"]>(
    workspace?.layoutConfig?.insertionPosition || "second"
  );

  if (!workspace) return null;

  const handleSave = () => {
    updateWorkspaceLayoutConfig(workspaceId, {
      insertionMode,
      splitPercentage,
      insertionPosition,
    });
    onOpenChange(false);
  };

  const handleReset = () => {
    setInsertionMode("smart");
    setSplitPercentage(50);
    setInsertionPosition("second");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            Workspace {workspace.number}
            {workspace.label && ` - ${workspace.label}`} Settings
          </DialogTitle>
          <DialogDescription>
            Configure how new windows are inserted into this workspace layout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Insertion Mode */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Insertion Mode</Label>
            <div className="grid gap-2">
              <button
                onClick={() => setInsertionMode("smart")}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-md border-2 transition-all",
                  insertionMode === "smart"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <Sparkles className="h-5 w-5 text-primary" />
                <div className="flex-1 text-left">
                  <div className="font-medium text-sm">Balanced (auto)</div>
                  <div className="text-xs text-muted-foreground">
                    Automatically balances horizontal and vertical splits
                  </div>
                </div>
              </button>

              <button
                onClick={() => setInsertionMode("row")}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-md border-2 transition-all",
                  insertionMode === "row"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <SplitSquareHorizontal className="h-5 w-5 text-primary" />
                <div className="flex-1 text-left">
                  <div className="font-medium text-sm">Horizontal (side-by-side)</div>
                  <div className="text-xs text-muted-foreground">
                    New windows always split horizontally
                  </div>
                </div>
              </button>

              <button
                onClick={() => setInsertionMode("column")}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-md border-2 transition-all",
                  insertionMode === "column"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <SplitSquareVertical className="h-5 w-5 text-primary" />
                <div className="flex-1 text-left">
                  <div className="font-medium text-sm">Vertical (stacked)</div>
                  <div className="text-xs text-muted-foreground">
                    New windows always split vertically
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Split Percentage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Split Percentage</Label>
              <span className="text-sm text-muted-foreground">
                {splitPercentage}% / {100 - splitPercentage}%
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="90"
              value={splitPercentage}
              onChange={(e) => setSplitPercentage(Number(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Existing content gets {splitPercentage}%</span>
              <span>New window gets {100 - splitPercentage}%</span>
            </div>
          </div>

          {/* Insertion Position */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Insertion Position</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setInsertionPosition("first")}
                className={cn(
                  "p-3 rounded-md border-2 transition-all text-sm",
                  insertionPosition === "first"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <div className="font-medium">Left / Top</div>
                <div className="text-xs text-muted-foreground mt-1">
                  New window first
                </div>
              </button>

              <button
                onClick={() => setInsertionPosition("second")}
                className={cn(
                  "p-3 rounded-md border-2 transition-all text-sm",
                  insertionPosition === "second"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <div className="font-medium">Right / Bottom</div>
                <div className="text-xs text-muted-foreground mt-1">
                  New window second
                </div>
              </button>
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-md border border-border bg-muted/30 p-4">
            <div className="text-xs text-muted-foreground mb-2">Preview:</div>
            <div className="text-sm">
              <span className="font-medium">
                {insertionMode === "smart" && "Smart mode"}
                {insertionMode === "row" && "Horizontal splits"}
                {insertionMode === "column" && "Vertical splits"}
              </span>
              {" · "}
              <span>
                {splitPercentage}%/{100 - splitPercentage}% split
              </span>
              {" · "}
              <span>
                New window on{" "}
                {insertionPosition === "first" ? "left/top" : "right/bottom"}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
