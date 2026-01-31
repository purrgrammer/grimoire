/**
 * AIPromptsViewer - Manage AI system prompts
 *
 * View, create, edit, and delete custom system prompts.
 */

import { useState, memo } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Sparkles,
  FileText,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSystemPrompts, GRIMOIRE_PROMPT_ID } from "@/hooks/useSystemPrompts";
import { cn } from "@/lib/utils";
import { CenteredContent } from "./ui/CenteredContent";
import type { LLMSystemPrompt } from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Prompt Card
// ─────────────────────────────────────────────────────────────

const PromptCard = memo(function PromptCard({
  prompt,
  onEdit,
  onDelete,
  onView,
}: {
  prompt: LLMSystemPrompt;
  onEdit?: () => void;
  onDelete?: () => void;
  onView: () => void;
}) {
  const isGrimoire = prompt.id === GRIMOIRE_PROMPT_ID;

  return (
    <div
      className={cn(
        "border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors",
        isGrimoire && "border-primary/50 bg-primary/5",
      )}
      onClick={onView}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isGrimoire ? (
            <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <div className="min-w-0">
            <h3 className="font-medium truncate">{prompt.name}</h3>
            {prompt.description && (
              <p className="text-sm text-muted-foreground truncate">
                {prompt.description}
              </p>
            )}
          </div>
        </div>

        {!prompt.isBuiltin && (
          <div className="flex gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.();
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {prompt.content.length.toLocaleString()} characters
        {isGrimoire && " • Auto-generated with protocol knowledge"}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// Prompt Editor
// ─────────────────────────────────────────────────────────────

function PromptEditor({
  prompt,
  onSave,
  onCancel,
}: {
  prompt?: LLMSystemPrompt;
  onSave: (name: string, content: string, description?: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(prompt?.name ?? "");
  const [description, setDescription] = useState(prompt?.description ?? "");
  const [content, setContent] = useState(prompt?.content ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    onSave(name.trim(), content.trim(), description.trim() || undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Custom Prompt"
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Description (optional)</label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of what this prompt does"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">System Prompt</label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="You are a helpful assistant..."
          className="min-h-[200px] font-mono text-sm"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || !content.trim()}>
          <Check className="h-4 w-4 mr-2" />
          {prompt ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Prompt Viewer (read-only)
// ─────────────────────────────────────────────────────────────

function PromptViewer({
  prompt,
  onBack,
  onEdit,
}: {
  prompt: LLMSystemPrompt;
  onBack: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium">{prompt.name}</h2>
          {prompt.description && (
            <p className="text-sm text-muted-foreground">
              {prompt.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          {!prompt.isBuiltin && onEdit && (
            <Button onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-muted/30">
        <pre className="whitespace-pre-wrap text-sm font-mono">
          {prompt.content}
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

type ViewState =
  | { mode: "list" }
  | { mode: "view"; promptId: string }
  | { mode: "edit"; promptId: string }
  | { mode: "create" };

export default function AIPromptsViewer() {
  const { prompts, createPrompt, updatePrompt, deletePrompt, getPrompt } =
    useSystemPrompts();
  const [view, setView] = useState<ViewState>({ mode: "list" });

  const handleCreate = async (
    name: string,
    content: string,
    description?: string,
  ) => {
    await createPrompt(name, content, description);
    setView({ mode: "list" });
  };

  const handleUpdate = async (
    id: string,
    name: string,
    content: string,
    description?: string,
  ) => {
    await updatePrompt(id, { name, content, description });
    setView({ mode: "view", promptId: id });
  };

  const handleDelete = async (id: string) => {
    await deletePrompt(id);
    setView({ mode: "list" });
  };

  // Render based on view state
  if (view.mode === "create") {
    return (
      <CenteredContent>
        <div className="w-full max-w-2xl">
          <h2 className="text-lg font-medium mb-4">Create System Prompt</h2>
          <PromptEditor
            onSave={handleCreate}
            onCancel={() => setView({ mode: "list" })}
          />
        </div>
      </CenteredContent>
    );
  }

  if (view.mode === "edit") {
    const prompt = getPrompt(view.promptId);
    if (!prompt) {
      setView({ mode: "list" });
      return null;
    }

    return (
      <CenteredContent>
        <div className="w-full max-w-2xl">
          <h2 className="text-lg font-medium mb-4">Edit System Prompt</h2>
          <PromptEditor
            prompt={prompt}
            onSave={(name, content, description) =>
              handleUpdate(view.promptId, name, content, description)
            }
            onCancel={() => setView({ mode: "view", promptId: view.promptId })}
          />
        </div>
      </CenteredContent>
    );
  }

  if (view.mode === "view") {
    const prompt = getPrompt(view.promptId);
    if (!prompt) {
      setView({ mode: "list" });
      return null;
    }

    return (
      <CenteredContent>
        <div className="w-full max-w-2xl">
          <PromptViewer
            prompt={prompt}
            onBack={() => setView({ mode: "list" })}
            onEdit={() => setView({ mode: "edit", promptId: view.promptId })}
          />
        </div>
      </CenteredContent>
    );
  }

  // List view
  return (
    <CenteredContent>
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">System Prompts</h2>
            <p className="text-sm text-muted-foreground">
              Customize how the AI assistant behaves
            </p>
          </div>
          <Button onClick={() => setView({ mode: "create" })}>
            <Plus className="h-4 w-4 mr-2" />
            Create
          </Button>
        </div>

        <div className="space-y-3">
          {prompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              onView={() => setView({ mode: "view", promptId: prompt.id })}
              onEdit={() => setView({ mode: "edit", promptId: prompt.id })}
              onDelete={() => handleDelete(prompt.id)}
            />
          ))}
        </div>

        {prompts.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No custom prompts yet. Click "Create" to add one.
          </div>
        )}
      </div>
    </CenteredContent>
  );
}
