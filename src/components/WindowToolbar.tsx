import { X, Pencil, MoreVertical, WandSparkles } from "lucide-react";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { WindowInstance } from "@/types/app";
import { commandLauncherEditModeAtom } from "@/core/command-launcher-state";
import { reconstructCommand } from "@/lib/command-reconstructor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpellDialog } from "@/components/nostr/SpellDialog";
import { reconstructCommand as reconstructReqCommand } from "@/lib/spell-conversion";
import { toast } from "sonner";

interface WindowToolbarProps {
  window?: WindowInstance;
  onClose?: () => void;
  onEditCommand?: () => void; // Callback to open CommandLauncher
}

export function WindowToolbar({
  window,
  onClose,
  onEditCommand,
}: WindowToolbarProps) {
  const setEditMode = useSetAtom(commandLauncherEditModeAtom);
  const [showSpellDialog, setShowSpellDialog] = useState(false);

  const handleEdit = () => {
    if (!window) return;

    // Get command string (existing or reconstructed)
    const commandString = window.commandString || reconstructCommand(window);

    // Set edit mode state
    setEditMode({
      windowId: window.id,
      initialCommand: commandString,
    });

    // Open CommandLauncher
    if (onEditCommand) {
      onEditCommand();
    }
  };

  const handleTurnIntoSpell = () => {
    if (!window) return;

    // Only available for REQ windows
    if (window.appId !== "req") {
      toast.error("Only REQ windows can be turned into spells");
      return;
    }

    setShowSpellDialog(true);
  };

  // Check if this is a REQ window for spell creation
  const isReqWindow = window?.appId === "req";

  // Get REQ command for spell dialog
  const reqCommand =
    isReqWindow && window
      ? window.commandString ||
        reconstructReqCommand(
          window.props?.filter || {},
          window.props?.relays,
          undefined,
          undefined,
          window.props?.closeOnEose,
        )
      : "";

  return (
    <>
      {window && (
        <>
          {/* Edit button with keyboard shortcut hint */}
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            onClick={handleEdit}
            title="Edit command (Cmd+E)"
            aria-label="Edit command"
          >
            <Pencil className="size-4" />
          </button>

          {/* More actions menu - only for REQ windows for now */}
          {isReqWindow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  title="More actions"
                  aria-label="More actions"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleTurnIntoSpell}>
                  <WandSparkles className="size-4 mr-2" />
                  Save as spell
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Spell Dialog */}
          {isReqWindow && (
            <SpellDialog
              open={showSpellDialog}
              onOpenChange={setShowSpellDialog}
              mode="create"
              initialCommand={reqCommand}
              onSuccess={() => {
                toast.success("Spell published successfully!");
              }}
            />
          )}
        </>
      )}
      {onClose && (
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={onClose}
          title="Close window (Cmd+W)"
          aria-label="Close window"
        >
          <X className="size-4" />
        </button>
      )}
    </>
  );
}
