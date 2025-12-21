import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { useGrimoire } from "@/core/state";
import { toast } from "sonner";
import { saveSpellbook } from "@/services/spellbook-storage";
import { PublishSpellbook } from "@/actions/publish-spellbook";
import { hub } from "@/services/hub";
import { createSpellbook } from "@/lib/spellbook-manager";
import { Loader2, Save, Send } from "lucide-react";

interface SaveSpellbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingSpellbook?: {
    slug: string;
    title: string;
    description?: string;
    workspaceIds?: string[];
    localId?: string;
    pubkey?: string;
  };
}

export function SaveSpellbookDialog({
  open,
  onOpenChange,
  existingSpellbook,
}: SaveSpellbookDialogProps) {
  const { state, loadSpellbook } = useGrimoire();
  const isUpdateMode = !!existingSpellbook;

  const [title, setTitle] = useState(existingSpellbook?.title || "");
  const [description, setDescription] = useState(existingSpellbook?.description || "");
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>(
    existingSpellbook?.workspaceIds || Object.keys(state.workspaces),
  );
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Update form when dialog opens with existing spellbook data
  useEffect(() => {
    if (open && existingSpellbook) {
      setTitle(existingSpellbook.title);
      setDescription(existingSpellbook.description || "");
      setSelectedWorkspaces(
        existingSpellbook.workspaceIds || Object.keys(state.workspaces),
      );
    } else if (open && !existingSpellbook) {
      // Reset form for new spellbook
      setTitle("");
      setDescription("");
      setSelectedWorkspaces(Object.keys(state.workspaces));
    }
  }, [open, existingSpellbook, state.workspaces]);

  const handleSave = async (shouldPublish: boolean) => {
    if (!title.trim()) {
      toast.error("Please enter a title for your spellbook");
      return;
    }

    if (selectedWorkspaces.length === 0) {
      toast.error("Please select at least one tab to include");
      return;
    }

    setIsSaving(true);
    if (shouldPublish) setIsPublishing(true);

    try {
      // 1. Create content
      const encoded = createSpellbook({
        state,
        title,
        description,
        workspaceIds: selectedWorkspaces,
      });

      // 2. Determine slug (keep existing for updates, generate for new)
      const slug = isUpdateMode
        ? existingSpellbook.slug
        : title.toLowerCase().trim().replace(/\s+/g, "-");

      // 3. Save locally (pass existing ID in update mode to prevent duplicates)
      const localSpellbook = await saveSpellbook({
        id: isUpdateMode ? existingSpellbook.localId : undefined,
        slug,
        title,
        description,
        content: JSON.parse(encoded.eventProps.content),
        isPublished: false,
      });

      // 4. Optionally publish
      if (shouldPublish) {
        await hub.run(PublishSpellbook, {
          state,
          title,
          description,
          workspaceIds: selectedWorkspaces,
          localId: existingSpellbook?.localId || localSpellbook.id,
          content: localSpellbook.content, // Pass explicitly to avoid re-calculating
        });
        toast.success(
          isUpdateMode
            ? "Spellbook updated and published to Nostr"
            : "Spellbook saved and published to Nostr",
        );
      } else {
        toast.success(
          isUpdateMode ? "Spellbook updated locally" : "Spellbook saved locally",
        );
      }

      // 5. Set as active spellbook
      const parsedSpellbook = {
        slug,
        title,
        description: description || undefined,
        content: localSpellbook.content,
        referencedSpells: [],
        event: localSpellbook.event as any, // Event might not exist for locally-only spellbooks
      };
      loadSpellbook(parsedSpellbook);

      onOpenChange(false);
      // Reset form only if creating new
      if (!isUpdateMode) {
        setTitle("");
        setDescription("");
        setSelectedWorkspaces(Object.keys(state.workspaces));
      }
    } catch (error) {
      console.error("Failed to save spellbook:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to save spellbook",
      );
    } finally {
      setIsSaving(false);
      setIsPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isUpdateMode ? "Update Spellbook" : "Save Layout as Spellbook"}
          </DialogTitle>
          <DialogDescription>
            {isUpdateMode
              ? "Update the configuration of your spellbook."
              : "Save your current workspaces and window configuration."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Title</Label>
            <Input
              id="title"
              placeholder="e.g. My Daily Dashboard"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="What is this layout for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label>Tabs to include</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {Object.values(state.workspaces)
                .sort((a, b) => a.number - b.number)
                .map((ws) => (
                  <div key={ws.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`ws-${ws.id}`}
                      checked={selectedWorkspaces.includes(ws.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedWorkspaces([...selectedWorkspaces, ws.id]);
                        } else {
                          setSelectedWorkspaces(
                            selectedWorkspaces.filter((id) => id !== ws.id),
                          );
                        }
                      }}
                    />
                    <label
                      htmlFor={`ws-${ws.id}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {ws.number}. {ws.label || "Tab"}
                    </label>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={isSaving}
          >
            {isSaving && !isPublishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Locally
          </Button>
          <Button onClick={() => handleSave(true)} disabled={isSaving}>
            {isPublishing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Save & Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
