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
import { Loader2 } from "lucide-react";
import { saveSpell } from "@/services/spell-storage";
import { PublishSpellAction } from "@/actions/publish-spell";
import { useAccount } from "@/hooks/useAccount";

interface CreateParameterizedSpellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parameterType: "$pubkey" | "$event" | "$relay";
  onSuccess?: () => void;
}

type PublishingState =
  | "idle"
  | "validating"
  | "signing"
  | "publishing"
  | "saving"
  | "error";

const PARAMETER_INFO: Record<
  "$pubkey" | "$event" | "$relay",
  {
    title: string;
    description: string;
    placeholder: string;
    variable: string;
    variableDescription: string;
    defaultValue?: string;
    requireVariable: boolean;
  }
> = {
  $pubkey: {
    title: "Create Profile Spell",
    description: "Create a spell that works with any profile",
    placeholder: "req -k 1 -a $pubkey -l 50",
    variable: "$pubkey",
    variableDescription:
      "Use $pubkey in your command to reference the target profile",
    defaultValue: "$me",
    requireVariable: true,
  },
  $event: {
    title: "Create Event Spell",
    description: "Create a spell that works with any event",
    placeholder: "req -k 1 -e $event -l 50",
    variable: "$event",
    variableDescription:
      "Use $event in your command (e.g., -e $event for replies, --id $event for direct reference)",
    requireVariable: true,
  },
  $relay: {
    title: "Create Relay Spell",
    description: "Create a spell that works with any relay",
    placeholder: "req -k 1 -l 50",
    variable: "$relay",
    variableDescription:
      "$relay is implicitly used for filtering - you can optionally use it in tags like -d $relay",
    requireVariable: false,
  },
};

export function CreateParameterizedSpellDialog({
  open,
  onOpenChange,
  parameterType,
  onSuccess,
}: CreateParameterizedSpellDialogProps) {
  const { canSign } = useAccount();

  // Form state
  const [command, setCommand] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Publishing/saving state
  const [publishingState, setPublishingState] =
    useState<PublishingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const info = PARAMETER_INFO[parameterType];

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setCommand("");
      setName("");
      setDescription("");
      setPublishingState("idle");
      setErrorMessage("");
    }
  }, [open]);

  // Validation
  const commandValid = command.trim().length > 0;
  const nameValid = name.trim().length > 0;
  const hasRequiredVariable =
    !info.requireVariable || command.includes(info.variable);

  const isFormValid = commandValid && nameValid && hasRequiredVariable;

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
    setCommand("");
    setName("");
    setDescription("");
    setPublishingState("idle");
    setErrorMessage("");
    onOpenChange(false);
  };

  // Handle local save (no publishing)
  const handleSaveLocally = async () => {
    if (!isFormValid) return;

    try {
      setPublishingState("saving");
      setErrorMessage("");

      // Save to local storage
      await saveSpell({
        name: name.trim(),
        command: command.trim(),
        description: description.trim() || undefined,
        isPublished: false,
        parameterType,
        parameterDefault: [info.defaultValue || info.variable],
      });

      // Success!
      setPublishingState("idle");

      if (onSuccess) {
        onSuccess();
      }

      toast.success(`${name.trim()} saved locally!`, {
        description: "Your spell has been saved to local storage.",
      });

      // Close dialog
      handleClose();
    } catch (error) {
      console.error("Failed to save spell locally:", error);
      setPublishingState("error");

      const message =
        error instanceof Error ? error.message : "An unexpected error occurred";
      setErrorMessage(message);

      toast.error("Failed to save spell", {
        description: message,
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

      // 1. Save locally first (to get an ID)
      setPublishingState("saving");
      const localSpell = await saveSpell({
        name: name.trim(),
        command: command.trim(),
        description: description.trim() || undefined,
        isPublished: false,
        parameterType,
        parameterDefault: [info.defaultValue || info.variable],
      });

      // 2. Use PublishSpellAction to handle signing and publishing
      setPublishingState("publishing");
      const action = new PublishSpellAction();
      await action.execute(localSpell);

      // Success!
      setPublishingState("idle");

      toast.success(`${name.trim()} published!`, {
        description: `Your spell has been saved and published to Nostr.`,
      });

      if (onSuccess) {
        onSuccess();
      }

      // Close dialog
      handleClose();
    } catch (error) {
      console.error("Failed to publish spell:", error);
      setPublishingState("error");

      // Handle specific errors
      const message =
        error instanceof Error
          ? error.message.includes("User rejected")
            ? "Signing was rejected. Please try again."
            : error.message
          : "Failed to publish spell. Please try again.";

      setErrorMessage(message);

      toast.error("Failed to publish spell", {
        description: message,
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
          <DialogTitle>{info.title}</DialogTitle>
          <DialogDescription>{info.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name field - REQUIRED */}
          <div className="grid gap-2">
            <label htmlFor="name" className="text-sm font-medium">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              id="name"
              placeholder="Bitcoin Posts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isBusy}
              required
            />
            <p className="text-muted-foreground text-xs">
              Required - Name shown in spell tabs
            </p>
          </div>

          {/* Command field - REQUIRED */}
          <div className="grid gap-2">
            <label htmlFor="command" className="text-sm font-medium">
              Command <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="command"
              placeholder={info.placeholder}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={isBusy}
              required
              rows={3}
              className="font-mono text-sm"
            />
            <p className="text-muted-foreground text-xs">
              {info.variableDescription}
            </p>
            {commandValid && !hasRequiredVariable && (
              <p className="text-red-500 text-xs">
                ⚠️ Command must include{" "}
                <code className="font-mono">{info.variable}</code>
              </p>
            )}
          </div>

          {/* Description field */}
          <div className="grid gap-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </label>
            <Textarea
              id="description"
              placeholder="Shows recent Bitcoin-related posts"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={2}
            />
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
              "Save & Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
