/**
 * AIProvidersViewer - Manage AI Providers
 *
 * Allows users to add, edit, and remove LLM providers (WebLLM, PPQ.ai).
 */

import { useState } from "react";
import {
  Plus,
  Trash2,
  ExternalLink,
  Check,
  Download,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLLMProviders, useLLMModels, useWebLLMStatus } from "@/hooks/useLLM";
import type { LLMModel, LLMProviderInstance } from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Add Provider Dialog
// ─────────────────────────────────────────────────────────────

function AddProviderDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (instance: Omit<LLMProviderInstance, "id">) => void;
}) {
  const { configs } = useLLMProviders();
  const [providerId, setProviderId] = useState("webllm");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");

  const selectedConfig = configs.find((c) => c.id === providerId);

  const handleSave = () => {
    onSave({
      providerId,
      name: name || selectedConfig?.name || providerId,
      apiKey: selectedConfig?.requiresApiKey ? apiKey : undefined,
      enabled: true,
    });
    onOpenChange(false);
    setName("");
    setApiKey("");
    setProviderId("webllm");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {configs.map((config) => (
                  <SelectItem key={config.id} value={config.id}>
                    {config.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Display Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selectedConfig?.name}
            />
          </div>

          {selectedConfig?.requiresApiKey && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>API Key</Label>
                {selectedConfig.apiKeyUrl && (
                  <a
                    href={selectedConfig.apiKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    Get API Key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={selectedConfig?.requiresApiKey && !apiKey}
          >
            Add Provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// WebLLM Model Manager
// ─────────────────────────────────────────────────────────────

function WebLLMModelManager({ instanceId }: { instanceId: string }) {
  const { models, loading, refresh } = useLLMModels(instanceId);
  const { status, loadModel, deleteModel } = useWebLLMStatus();

  const isLoading = status.state === "loading";
  const loadedModelId = status.state === "ready" ? status.modelId : null;

  const handleDelete = async (modelId: string) => {
    await deleteModel(modelId);
    refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium text-muted-foreground mb-1">
        Available Models
      </div>
      {models.map((model) => (
        <ModelItem
          key={model.id}
          model={model}
          isLoaded={model.id === loadedModelId}
          isLoading={isLoading && status.state === "loading"}
          loadingProgress={
            isLoading && status.state === "loading" ? status.progress : 0
          }
          loadingText={
            isLoading && status.state === "loading" ? status.text : ""
          }
          onLoad={() => loadModel(model.id)}
          onDelete={() => handleDelete(model.id)}
        />
      ))}
    </div>
  );
}

function ModelItem({
  model,
  isLoaded,
  isLoading,
  loadingProgress,
  loadingText,
  onLoad,
  onDelete,
}: {
  model: LLMModel;
  isLoaded: boolean;
  isLoading: boolean;
  loadingProgress: number;
  loadingText: string;
  onLoad: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 p-2 rounded-md border",
        isLoaded && "border-primary bg-primary/5",
        model.isDownloaded && !isLoaded && "border-muted-foreground/30",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{model.name}</span>
          {isLoaded && (
            <span className="text-xs text-primary font-medium">Active</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {model.downloadSize}
          {model.description && ` - ${model.description}`}
        </div>
        {isLoading && (
          <div className="mt-2">
            <Progress value={loadingProgress * 100} className="h-1" />
            <div className="text-xs text-muted-foreground mt-1 truncate">
              {loadingText}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {model.isDownloaded ? (
          <>
            {!isLoaded && (
              <Button size="sm" variant="outline" onClick={onLoad}>
                <Check className="h-3 w-3 mr-1" />
                Load
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={onLoad}>
            <Download className="h-3 w-3 mr-1" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Provider Card
// ─────────────────────────────────────────────────────────────

function ProviderCard({
  instance,
  onDelete,
}: {
  instance: LLMProviderInstance;
  onDelete: () => void;
}) {
  const { configs } = useLLMProviders();
  const config = configs.find((c) => c.id === instance.providerId);
  const isWebLLM = instance.providerId === "webllm";

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-medium">{instance.name}</div>
          <div className="text-xs text-muted-foreground">
            {config?.name || instance.providerId}
            {instance.apiKey && " - API key configured"}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {isWebLLM && <WebLLMModelManager instanceId={instance.id} />}

      {!isWebLLM && config?.topUpUrl && (
        <a
          href={config.topUpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mt-2"
        >
          Top up balance <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export function AIProvidersViewer() {
  const { instances, addInstance, removeInstance } = useLLMProviders();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const handleAddProvider = async (
    instance: Omit<LLMProviderInstance, "id">,
  ) => {
    await addInstance(instance);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-3 flex items-center justify-between">
        <div className="font-medium">AI Providers</div>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Provider
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        {instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <div className="text-muted-foreground text-sm">
              No providers configured
            </div>
            <Button variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Provider
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {instances.map((instance) => (
              <ProviderCard
                key={instance.id}
                instance={instance}
                onDelete={() => removeInstance(instance.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <AddProviderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSave={handleAddProvider}
      />
    </div>
  );
}
