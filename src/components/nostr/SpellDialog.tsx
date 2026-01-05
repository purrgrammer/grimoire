import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { use$ } from "applesauce-react/hooks";
import accounts from "@/services/accounts";
import { parseReqCommand } from "@/lib/req-parser";
import { reconstructCommand } from "@/lib/spell-conversion";
import type { ParsedSpell, SpellEvent } from "@/types/spell";
import { Loader2 } from "lucide-react";
import { saveSpell } from "@/services/spell-storage";
import { LocalSpell } from "@/services/db";
import { PublishSpellAction } from "@/actions/publish-spell";

/**
 * Filter command to show only spell-relevant parts
 * Removes global flags like --title that don't affect the filter
 */
function filterSpellCommand(command: string): string {
  if (!command) return "";

  try {
    // Parse the command
    const commandWithoutReq = command.replace(/^\s*req\s+/, "");
    const tokens = commandWithoutReq.split(/\s+/);

    // Parse to get filter and relays
    const parsed = parseReqCommand(tokens);

    // Reconstruct with only filter-relevant parts
    return reconstructCommand(
      parsed.filter,
      parsed.relays,
      undefined,
      undefined,
      parsed.closeOnEose,
    );
  } catch {
    // If parsing fails, return original
    return command;
  }
}

interface SpellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialCommand?: string;
  existingSpell?: ParsedSpell | LocalSpell;
  onSuccess?: (event: SpellEvent | null) => void;
}

type PublishingState =
  | "idle"
  | "validating"
  | "signing"
  | "publishing"
  | "saving"
  | "error";

export function SpellDialog({
  open,
  onOpenChange,
  mode,
  initialCommand = "",
  existingSpell,
  onSuccess,
}: SpellDialogProps) {
  const activeAccount = use$(accounts.active$);

  // Form state
  const [alias, setAlias] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Publishing/saving state
  const [publishingState, setPublishingState] =
    useState<PublishingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Initialize form from existing spell in edit mode
  useEffect(() => {
    if (mode === "edit" && existingSpell) {
      setAlias("alias" in existingSpell ? existingSpell.alias || "" : "");
      setName(existingSpell.name || "");
      setDescription(existingSpell.description || "");
    } else if (mode === "create") {
      // Reset form for create mode
      setAlias("");
      setName("");
      setDescription("");
    }
  }, [mode, existingSpell, open]);

  // Form is always valid (all fields optional)
  const isFormValid = true;

  // Reset form and close dialog
  const handleClose = () => {
    if (
      publishingState === "signing" ||
      publishingState === "publishing" ||
      publishingState === "saving"
    ) {
      // Prevent closing during critical operations
      return;
    }
    setAlias("");
    setName("");
    setDescription("");
    setPublishingState("idle");
    setErrorMessage("");
    onOpenChange(false);
  };

  // Handle local save (no publishing)
  const handleSaveLocally = async () => {
    try {
      setPublishingState("saving");
      setErrorMessage("");

      // Get command (from initialCommand or existing spell)
      const command =
        mode === "edit" && existingSpell
          ? existingSpell.command
          : initialCommand;

      if (!command) {
        throw new Error("No command provided");
      }

      // Save to local storage
      await saveSpell({
        alias: alias.trim() || undefined,
        name: name.trim() || undefined,
        command,
        description: description.trim() || undefined,
        isPublished: false,
      });

      // Success!
      setPublishingState("idle");

      // Call success callback
      if (onSuccess) {
        onSuccess(null);
      }

      const spellLabel = alias.trim() || name.trim() || "Spell";
      toast.success(`${spellLabel} saved locally!`, {
        description: "Your spell has been saved to local storage.",
      });

      // Close dialog
      handleClose();
    } catch (error) {
      console.error("Failed to save spell locally:", error);
      setPublishingState("error");

      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Failed to save spell. Please try again.");
      }

      toast.error("Failed to save spell", {
        description: errorMessage || "An unexpected error occurred.",
      });
    }
  };

  // Handle form submission (publish to Nostr)
  const handlePublish = async () => {
    if (!isFormValid) return;

    // Check for active account
    if (!activeAccount) {
      setErrorMessage("No active account. Please sign in first.");
      setPublishingState("error");
      return;
    }

    try {
      setPublishingState("validating");
      setErrorMessage("");

      // Get command (from initialCommand or existing spell)
      const command =
        mode === "edit" && existingSpell
          ? existingSpell.command
          : initialCommand;

      if (!command) {
        throw new Error("No command provided");
      }

      // 1. Save locally first (to get an ID)
      setPublishingState("saving");
      const localSpell = await saveSpell({
        alias: alias.trim() || undefined,
        name: name.trim() || undefined,
        command,
        description: description.trim() || undefined,
        isPublished: false,
      });

      // 2. Use PublishSpellAction to handle signing and publishing
      setPublishingState("publishing");
      const action = new PublishSpellAction();
      await action.execute(localSpell);

      // Success!
      setPublishingState("idle");

      const spellLabel = alias.trim() || name.trim() || "Spell";
      toast.success(`${spellLabel} published!`, {
        description: `Your spell has been saved and published to Nostr.`,
      });

      // Call success callback
      if (onSuccess) {
        // We don't easily have the event here anymore, but most callers don't use it
        // Or we could fetch it from storage if needed.
        onSuccess(null);
      }

      // Close dialog
      handleClose();
    } catch (error) {
      console.error("Failed to publish spell:", error);
      setPublishingState("error");

      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes("User rejected")) {
          setErrorMessage("Signing was rejected. Please try again.");
        } else if (error.message.includes("No command provided")) {
          setErrorMessage(
            "No command to save. Please try again from a REQ window.",
          );
        } else {
          setErrorMessage(error.message);
        }
      } else {
        setErrorMessage("Failed to publish spell. Please try again.");
      }

      toast.error("Failed to publish spell", {
        description: errorMessage || "An unexpected error occurred.",
      });
    }
  };

  const isBusy =
    publishingState === "signing" ||
    publishingState === "publishing" ||
    publishingState === "saving";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Save as Spell" : "Edit Spell"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Save this REQ command as a spell. You can save it locally or publish it to Nostr relays."
              : "Edit your spell and republish it to relays."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Alias field - local only */}
          <div className="grid gap-2">
            <label htmlFor="alias" className="text-sm font-medium">
              Alias{" "}
              <span className="text-muted-foreground text-xs">
                (optional, local-only)
              </span>
            </label>
            <Input
              id="alias"
              placeholder="btc"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              disabled={isBusy}
            />
            <p className="text-muted-foreground text-xs">
              Quick name for running this spell (not published)
            </p>
          </div>

          {/* Name field - published */}
          <div className="grid gap-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name{" "}
              <span className="text-muted-foreground text-xs">
                (optional, published)
              </span>
            </label>
            <Input
              id="name"
              placeholder="Bitcoin Feed"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBusy}
            />
            <p className="text-muted-foreground text-xs">
              Public spell name (shown to others if published)
            </p>
          </div>

          {/* Description field */}
          <div className="grid gap-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description{" "}
              <span className="text-muted-foreground text-xs">
                (optional, published)
              </span>
            </label>
            <Textarea
              id="description"
              placeholder="Notes from the last 7 days about Bitcoin"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={3}
            />
          </div>

          {/* Command display (read-only, filtered to show only spell parts) */}
          <div className="grid gap-2">
            <label htmlFor="command" className="text-sm font-medium">
              Command
            </label>
            <div className="rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono break-words overflow-x-auto">
              {filterSpellCommand(
                mode === "edit" && existingSpell
                  ? existingSpell.command
                  : initialCommand || "",
              ) || "(no filter)"}
            </div>
          </div>

          {/* Error message */}
          {publishingState === "error" && errorMessage && (
            <div className="rounded-md border border-red-500 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </div>
          )}

          {/* No account warning */}
          {!activeAccount && (
            <div className="rounded-md border border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-sm text-yellow-600 dark:text-yellow-400">
              You need to sign in to publish spells.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={handleSaveLocally}
            disabled={!isFormValid || isBusy}
          >
            {publishingState === "saving" && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {publishingState === "saving" ? "Saving..." : "Save Locally"}
          </Button>
          <Button
            onClick={handlePublish}
            disabled={!isFormValid || !activeAccount || isBusy}
          >
            {(publishingState === "signing" ||
              publishingState === "publishing") && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {publishingState === "signing" && "Signing..."}
            {publishingState === "publishing" && "Publishing..."}
            {publishingState !== "signing" &&
              publishingState !== "publishing" &&
              (mode === "create" ? "Save & Publish" : "Update Spell")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
