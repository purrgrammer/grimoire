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
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { parseReqCommand } from "@/lib/req-parser";
import { reconstructCommand, detectCommandType } from "@/lib/spell-conversion";
import type { ParsedSpell, SpellEvent } from "@/types/spell";
import { Loader2, Sparkles } from "lucide-react";
import { saveSpell } from "@/services/spell-storage";
import { LocalSpell } from "@/services/db";
import { PublishSpellAction } from "@/actions/publish-spell";
import { useAccount } from "@/hooks/useAccount";

/**
 * Filter command to show only spell-relevant parts
 * Removes global flags like --title that don't affect the filter
 */
function filterSpellCommand(command: string): string {
  if (!command) return "";

  try {
    // Detect command type (REQ or COUNT)
    const cmdType = detectCommandType(command);

    // Parse the command - remove prefix first
    const commandWithoutPrefix = command.replace(/^\s*(req|count)\s+/i, "");
    const tokens = commandWithoutPrefix.split(/\s+/);

    // Parse to get filter and relays
    const parsed = parseReqCommand(tokens);

    // Reconstruct with only filter-relevant parts
    return reconstructCommand(
      parsed.filter,
      parsed.relays,
      undefined,
      undefined,
      parsed.closeOnEose,
      cmdType,
    );
  } catch {
    // If parsing fails, return original
    return command;
  }
}

/**
 * Detect if command contains values that suggest parameterization
 * Returns suggested parameter type if detected
 */
function detectParameterSuggestion(
  command: string,
): "$pubkey" | "$event" | "$relay" | null {
  if (!command) return null;

  // Check for $me or $contacts (suggests $pubkey parameter)
  if (command.includes("$me") || command.includes("$contacts")) {
    return "$pubkey";
  }

  // Check for single author hex that's not $me/$contacts
  // (user might want to make it reusable)
  const authorMatch = command.match(/-a\s+([a-f0-9]{64})/);
  if (authorMatch) {
    return "$pubkey";
  }

  // Check for event ID or naddr (suggests $event parameter)
  const eventMatch = command.match(/-e\s+([a-f0-9]{64}|naddr1[a-z0-9]+)/);
  if (eventMatch) {
    return "$event";
  }

  return null;
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
  const { canSign, pubkey } = useAccount();

  // Form state
  const [alias, setAlias] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Parameter configuration
  const [parameterEnabled, setParameterEnabled] = useState(false);
  const [parameterType, setParameterType] = useState<
    "$pubkey" | "$event" | "$relay"
  >("$pubkey");
  const [parameterDefault, setParameterDefault] = useState<string>("$me");

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

      // Load parameter configuration from existing spell
      if ("parameterType" in existingSpell && existingSpell.parameterType) {
        setParameterEnabled(true);
        setParameterType(existingSpell.parameterType);
        setParameterDefault(existingSpell.parameterDefault?.[0] || "$me");
      } else if ("parameter" in existingSpell && existingSpell.parameter) {
        setParameterEnabled(true);
        setParameterType(existingSpell.parameter.type);
        setParameterDefault(existingSpell.parameter.default?.[0] || "$me");
      } else {
        setParameterEnabled(false);
      }
    } else if (mode === "create") {
      // Reset form for create mode
      setAlias("");
      setName("");
      setDescription("");

      // Auto-detect parameter suggestion
      const command = initialCommand || "";
      const suggestion = detectParameterSuggestion(command);
      if (suggestion) {
        setParameterType(suggestion);
        // Don't auto-enable, let user decide
        setParameterEnabled(false);
      }
    }
  }, [mode, existingSpell, open, initialCommand]);

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
        parameterType: parameterEnabled ? parameterType : undefined,
        parameterDefault: parameterEnabled ? [parameterDefault] : undefined,
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

    // Check for signing capability
    if (!canSign) {
      setErrorMessage(
        "You need a signing account to publish. Read-only accounts cannot publish.",
      );
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
        parameterType: parameterEnabled ? parameterType : undefined,
        parameterDefault: parameterEnabled ? [parameterDefault] : undefined,
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
            "No command to save. Please try again from a REQ or COUNT window.",
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
              ? "Save this command as a spell. You can save it locally or publish it to Nostr relays."
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

          {/* Parameter configuration */}
          <div className="rounded-lg border border-border/50 p-4 space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="parameter-enabled"
                checked={parameterEnabled}
                onCheckedChange={(checked) =>
                  setParameterEnabled(checked as boolean)
                }
                disabled={isBusy}
              />
              <label
                htmlFor="parameter-enabled"
                className="text-sm font-medium flex items-center gap-2 cursor-pointer"
              >
                <Sparkles className="h-4 w-4 text-purple-500" />
                Cast on any{" "}
                {parameterType === "$pubkey"
                  ? "profile"
                  : parameterType === "$event"
                    ? "event"
                    : "relay"}
              </label>
            </div>

            {parameterEnabled && (
              <div className="grid gap-3 pl-6">
                <div className="grid gap-2">
                  <label
                    htmlFor="parameter-type"
                    className="text-sm font-medium"
                  >
                    Target type
                  </label>
                  <div className="flex gap-4">
                    {(
                      [
                        ["$pubkey", "Profile"],
                        ["$event", "Event"],
                        ["$relay", "Relay"],
                      ] as const
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name="parameter-type"
                          value={value}
                          checked={parameterType === value}
                          onChange={(e) =>
                            setParameterType(
                              e.target.value as "$pubkey" | "$event" | "$relay",
                            )
                          }
                          disabled={isBusy}
                          className="cursor-pointer"
                        />
                        <span className="text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {parameterType === "$pubkey" &&
                      "Apply this spell to any user's profile"}
                    {parameterType === "$event" &&
                      "Apply this spell to any event"}
                    {parameterType === "$relay" &&
                      "Apply this spell to any relay"}
                  </p>
                </div>

                {parameterType === "$pubkey" && (
                  <div className="grid gap-2">
                    <label
                      htmlFor="parameter-default"
                      className="text-sm font-medium"
                    >
                      Default value{" "}
                      <span className="text-muted-foreground text-xs">
                        (optional)
                      </span>
                    </label>
                    <select
                      id="parameter-default"
                      value={parameterDefault}
                      onChange={(e) => setParameterDefault(e.target.value)}
                      disabled={isBusy}
                      className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="$me">Current user ($me)</option>
                      {pubkey && (
                        <option value={pubkey}>
                          My pubkey ({pubkey.slice(0, 8)}...)
                        </option>
                      )}
                    </select>
                    <p className="text-muted-foreground text-xs">
                      Value used when no argument provided
                    </p>
                  </div>
                )}
              </div>
            )}

            {!parameterEnabled &&
              detectParameterSuggestion(
                mode === "edit" && existingSpell
                  ? existingSpell.command
                  : initialCommand || "",
              ) && (
                <p className="text-muted-foreground text-xs pl-6">
                  💡 This command uses{" "}
                  {parameterType === "$pubkey"
                    ? "a user"
                    : parameterType === "$event"
                      ? "an event"
                      : "a relay"}
                  . Enable this to make it work with any{" "}
                  {parameterType === "$pubkey"
                    ? "profile"
                    : parameterType === "$event"
                      ? "event"
                      : "relay"}
                  .
                </p>
              )}
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

          {/* No signing capability warning */}
          {!canSign && (
            <div className="rounded-md border border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-2 text-sm text-yellow-600 dark:text-yellow-400">
              You need a signing account to publish spells. Read-only accounts
              cannot publish.
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
            disabled={!isFormValid || !canSign || isBusy}
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
