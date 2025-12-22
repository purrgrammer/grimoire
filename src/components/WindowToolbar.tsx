import {
  X,
  Pencil,
  MoreVertical,
  WandSparkles,
  Copy,
  CopyCheck,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { SpellDialog } from "@/components/nostr/SpellDialog";
import { reconstructCommand as reconstructReqCommand } from "@/lib/spell-conversion";
import { toast } from "sonner";
import { useCopy } from "@/hooks/useCopy";
import { useNip } from "@/hooks/useNip";

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

  // Copy functionality for NIPs
  const { copy, copied } = useCopy();
  const isNipWindow = window?.appId === "nip";

  // Fetch NIP content for regular NIPs
  const { content: nipContent } = useNip(
    isNipWindow && window?.props?.number ? window.props.number : "",
  );

  const handleCopyNip = () => {
    if (!window || !nipContent) return;

    copy(nipContent);
    toast.success("NIP markdown copied to clipboard");
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
          {/* Edit button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleEdit}
            title="Edit command"
            aria-label="Edit command"
          >
            <Pencil className="size-4" />
          </Button>

          {/* Copy button for NIPs */}
          {isNipWindow && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopyNip}
              title="Copy NIP markdown"
              aria-label="Copy NIP markdown"
              disabled={!nipContent}
            >
              {copied ? <CopyCheck /> : <Copy />}
            </Button>
          )}

          {/* More actions menu - only for REQ windows for now */}
          {isReqWindow && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="More actions"
                  aria-label="More actions"
                >
                  <MoreVertical className="size-4" />
                </Button>
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
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          title="Close window"
          aria-label="Close window"
        >
          <X className="size-4" />
        </Button>
      )}
    </>
  );
}
