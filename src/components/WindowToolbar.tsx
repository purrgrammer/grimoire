import { X, Pencil } from "lucide-react";
import { useSetAtom } from "jotai";
import { WindowInstance } from "@/types/app";
import { commandLauncherEditModeAtom } from "@/core/command-launcher-state";
import { reconstructCommand } from "@/lib/command-reconstructor";

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

  const handleEdit = () => {
    if (!window) return;

    // Get command string (existing or reconstructed)
    const commandString =
      window.commandString || reconstructCommand(window);

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

  return (
    <>
      {window && (
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={handleEdit}
          title="Edit command"
        >
          <Pencil className="size-4" />
        </button>
      )}
      {onClose && (
        <button
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          onClick={onClose}
          title="Close window"
        >
          <X className="size-4" />
        </button>
      )}
    </>
  );
}
