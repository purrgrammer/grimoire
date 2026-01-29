import {
  X,
  Pencil,
  MoreVertical,
  WandSparkles,
  Copy,
  CopyCheck,
  ArrowRightFromLine,
  ExternalLink,
  Plus,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { SpellDialog } from "@/components/nostr/SpellDialog";
import { reconstructCommand as reconstructReqCommand } from "@/lib/spell-conversion";
import { toast } from "sonner";
import { useCopy } from "@/hooks/useCopy";
import { useNip } from "@/hooks/useNip";
import { useGrimoire } from "@/core/state";

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
  const { state, moveWindowToWorkspace, moveWindowToNewWorkspace } =
    useGrimoire();

  // Get workspaces for move action
  const otherWorkspaces = Object.values(state.workspaces)
    .filter((ws) => ws.id !== state.activeWorkspaceId)
    .sort((a, b) => a.number - b.number);

  const handleMoveToWorkspace = (targetWorkspaceId: string) => {
    if (!window) return;
    const targetWorkspace = state.workspaces[targetWorkspaceId];
    moveWindowToWorkspace(window.id, targetWorkspaceId);
    toast.success(
      `Moved to tab ${targetWorkspace.number}${targetWorkspace.label ? ` (${targetWorkspace.label})` : ""}`,
    );
  };

  const handleMoveToNewTab = () => {
    if (!window) return;
    moveWindowToNewWorkspace(window.id);
    toast.success("Moved to new tab");
  };

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

    // Only available for REQ and COUNT windows
    if (window.appId !== "req" && window.appId !== "count") {
      toast.error("Only REQ and COUNT windows can be turned into spells");
      return;
    }

    setShowSpellDialog(true);
  };

  const handlePopOut = () => {
    if (!window) return;

    // Get command string (existing or reconstructed)
    const commandString = window.commandString || reconstructCommand(window);

    // Construct the /run URL with the command as a query parameter
    const popOutUrl = `/run?cmd=${encodeURIComponent(commandString)}`;

    // Open in a new window/tab
    globalThis.window.open(popOutUrl, "_blank");
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

  // Check if this is a REQ or COUNT window for spell creation
  const isReqWindow = window?.appId === "req";
  const isCountWindow = window?.appId === "count";
  const isSpellableWindow = isReqWindow || isCountWindow;

  // Get command for spell dialog
  const spellCommand =
    isSpellableWindow && window
      ? window.commandString ||
        reconstructReqCommand(
          window.props?.filter || {},
          window.props?.relays,
          undefined,
          undefined,
          window.props?.closeOnEose,
          isCountWindow ? "COUNT" : "REQ",
        )
      : "";

  return (
    <>
      {window && (
        <>
          {/* Edit button */}
          <Button
            variant="link"
            size="icon"
            className="h-10 w-10 md:h-9 md:w-9 text-muted-foreground"
            onClick={handleEdit}
            title="Edit command"
            aria-label="Edit command"
          >
            <Pencil className="size-5 md:size-4" />
          </Button>

          {/* Copy button for NIPs */}
          {isNipWindow && (
            <Button
              variant="link"
              size="icon"
              className="h-10 w-10 md:h-9 md:w-9 text-muted-foreground"
              onClick={handleCopyNip}
              title="Copy NIP markdown"
              aria-label="Copy NIP markdown"
              disabled={!nipContent}
            >
              {copied ? (
                <CopyCheck className="size-5 md:size-4" />
              ) : (
                <Copy className="size-5 md:size-4" />
              )}
            </Button>
          )}

          {/* More actions menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="link"
                size="icon"
                className="h-10 w-10 md:h-9 md:w-9 text-muted-foreground"
                title="More actions"
                aria-label="More actions"
              >
                <MoreVertical className="size-5 md:size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Pop out window */}
              <DropdownMenuItem onClick={handlePopOut}>
                <ExternalLink className="size-4 mr-2" />
                Pop out window
              </DropdownMenuItem>

              {/* Move to tab submenu */}
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightFromLine className="size-4 mr-2" />
                  Move to tab
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onClick={handleMoveToNewTab}>
                    <Plus className="size-4 mr-2" />
                    New
                  </DropdownMenuItem>
                  {otherWorkspaces.length > 0 && <DropdownMenuSeparator />}
                  {otherWorkspaces.map((ws) => (
                    <DropdownMenuItem
                      key={ws.id}
                      onClick={() => handleMoveToWorkspace(ws.id)}
                    >
                      {ws.number}
                      {ws.label ? ` ${ws.label}` : ""}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {/* REQ/COUNT-specific actions */}
              {isSpellableWindow && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleTurnIntoSpell}>
                    <WandSparkles className="size-4 mr-2" />
                    Save as spell
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Spell Dialog */}
          {isSpellableWindow && (
            <SpellDialog
              open={showSpellDialog}
              onOpenChange={setShowSpellDialog}
              mode="create"
              initialCommand={spellCommand}
              onSuccess={() => {
                toast.success("Spell published successfully!");
              }}
            />
          )}
        </>
      )}
      {onClose && (
        <Button
          variant="link"
          size="icon"
          className="h-10 w-10 md:h-9 md:w-9 text-muted-foreground"
          onClick={onClose}
          title="Close window"
          aria-label="Close window"
        >
          <X className="size-5 md:size-4" />
        </Button>
      )}
    </>
  );
}
