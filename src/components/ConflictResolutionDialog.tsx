import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { AlertTriangle, Check, Clock, Layers, Layout } from "lucide-react";
import type { LocalSpellbook } from "@/services/db";
import type { ParsedSpellbook } from "@/types/spell";
import { compareSpellbookVersions } from "@/lib/spellbook-manager";
import { useProfile } from "@/hooks/useProfile";

interface ConflictResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  localSpellbook: LocalSpellbook;
  networkSpellbook: ParsedSpellbook;
  onResolve: (choice: "local" | "network") => void;
}

export function ConflictResolutionDialog({
  open,
  onOpenChange,
  localSpellbook,
  networkSpellbook,
  onResolve,
}: ConflictResolutionDialogProps) {
  const comparison = compareSpellbookVersions(
    {
      createdAt: localSpellbook.createdAt,
      content: localSpellbook.content,
      eventId: localSpellbook.eventId,
    },
    {
      created_at: networkSpellbook.event?.created_at || 0,
      content: networkSpellbook.content,
      id: networkSpellbook.event?.id || "",
    }
  );

  const authorProfile = useProfile(networkSpellbook.event?.pubkey);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const handleResolve = (choice: "local" | "network") => {
    onResolve(choice);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warning" />
            Spellbook Conflict Detected
          </DialogTitle>
          <DialogDescription>
            Your local version differs from the network version. Choose which
            version to keep.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-4">
          {/* Local Version */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Local Version</h3>
              {comparison.newerVersion === "local" && (
                <Badge variant="secondary" className="text-xs">
                  Newer
                </Badge>
              )}
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-4" />
                <span>{formatDate(comparison.differences.lastModified.local)}</span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Layers className="size-4" />
                <span>{comparison.differences.workspaceCount.local} workspaces</span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Layout className="size-4" />
                <span>{comparison.differences.windowCount.local} windows</span>
              </div>

              {localSpellbook.isPublished ? (
                <Badge variant="outline" className="text-xs">
                  Published
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  Local Only
                </Badge>
              )}
            </div>
          </div>

          {/* Network Version */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Network Version</h3>
              {comparison.newerVersion === "network" && (
                <Badge variant="secondary" className="text-xs">
                  Newer
                </Badge>
              )}
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="size-4" />
                <span>{formatDate(comparison.differences.lastModified.network)}</span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Layers className="size-4" />
                <span>
                  {comparison.differences.workspaceCount.network} workspaces
                </span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Layout className="size-4" />
                <span>{comparison.differences.windowCount.network} windows</span>
              </div>

              {authorProfile && (
                <div className="text-xs text-muted-foreground">
                  by {authorProfile.name || "Unknown"}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-muted p-3 text-sm">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">What happens when you choose?</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                <li>
                  <strong>Local:</strong> Keep your local changes and discard
                  network version
                </li>
                <li>
                  <strong>Network:</strong> Replace local with network version
                  (local changes lost)
                </li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="sm:flex-1"
          >
            Cancel
          </Button>
          <div className="flex gap-2 sm:flex-1">
            <Button
              variant="secondary"
              onClick={() => handleResolve("local")}
              className="flex-1"
            >
              <Check className="size-4 mr-2" />
              Keep Local
            </Button>
            <Button
              variant="default"
              onClick={() => handleResolve("network")}
              className="flex-1"
            >
              <Check className="size-4 mr-2" />
              Use Network
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
