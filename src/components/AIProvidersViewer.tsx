/**
 * AIProvidersViewer - Manage AI Providers
 *
 * Add, configure, and remove OpenAI-compatible AI providers.
 */

import { useState, memo } from "react";
import {
  Plus,
  Trash2,
  ExternalLink,
  Check,
  Loader2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLLMProviders, useTestConnection } from "@/hooks/useLLM";
import {
  AI_PROVIDER_PRESETS,
  type AIProviderPreset,
} from "@/lib/ai-provider-presets";
import type { LLMProviderInstance } from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Provider Preset Item
// ─────────────────────────────────────────────────────────────

const PresetItem = memo(function PresetItem({
  preset,
  onClick,
}: {
  preset: AIProviderPreset;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{preset.name}</div>
        {preset.description && (
          <div className="text-xs text-muted-foreground truncate">
            {preset.description}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
});

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
  onSave: (instance: Omit<LLMProviderInstance, "id">) => Promise<void>;
}) {
  const [step, setStep] = useState<"select" | "configure">("select");
  const [selectedPreset, setSelectedPreset] = useState<AIProviderPreset | null>(
    null,
  );
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const { testing, result, testConnection, reset } = useTestConnection();

  const handleSelectPreset = (preset: AIProviderPreset) => {
    setSelectedPreset(preset);
    setName(preset.name);
    setBaseUrl(preset.baseURL);
    setApiKey("");
    reset();
    setStep("configure");
  };

  const handleBack = () => {
    setStep("select");
    setSelectedPreset(null);
    reset();
  };

  const handleTest = async () => {
    if (!selectedPreset) return;

    const testInstance: LLMProviderInstance = {
      id: "test",
      providerId: selectedPreset.id,
      name: name || selectedPreset.name,
      apiKey: apiKey || undefined,
      baseUrl:
        selectedPreset.id === "custom" ? baseUrl : selectedPreset.baseURL,
      enabled: true,
    };

    await testConnection(testInstance);
  };

  const handleSave = async () => {
    if (!selectedPreset) return;

    setSaving(true);
    try {
      await onSave({
        providerId: selectedPreset.id,
        name: name || selectedPreset.name,
        apiKey: apiKey || undefined,
        baseUrl:
          selectedPreset.id === "custom" ? baseUrl : selectedPreset.baseURL,
        enabled: true,
      });
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after animation
    setTimeout(() => {
      setStep("select");
      setSelectedPreset(null);
      setName("");
      setApiKey("");
      setBaseUrl("");
      reset();
    }, 200);
  };

  const isCustom = selectedPreset?.id === "custom";
  const canSave = apiKey.trim() && (isCustom ? baseUrl.trim() : true);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "select" ? "Add Provider" : selectedPreset?.name}
          </DialogTitle>
          {step === "select" && (
            <DialogDescription>
              Choose an AI provider to configure
            </DialogDescription>
          )}
        </DialogHeader>

        {step === "select" ? (
          <ScrollArea className="max-h-[400px] pr-2">
            <div className="flex flex-col gap-2">
              {AI_PROVIDER_PRESETS.map((preset) => (
                <PresetItem
                  key={preset.id}
                  preset={preset}
                  onClick={() => handleSelectPreset(preset)}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                Display Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={selectedPreset?.name}
              />
            </div>

            {isCustom && (
              <div className="flex flex-col gap-2">
                <label htmlFor="baseUrl" className="text-sm font-medium">
                  Base URL
                </label>
                <Input
                  id="baseUrl"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                />
                <p className="text-xs text-muted-foreground">
                  OpenAI-compatible API endpoint
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="apiKey" className="text-sm font-medium">
                  API Key
                </label>
                {selectedPreset?.apiKeysURL && (
                  <a
                    href={selectedPreset.apiKeysURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    Get API Key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </div>

            {/* Test result */}
            {result && (
              <div
                className={cn(
                  "flex items-center gap-2 p-2 rounded-md text-sm",
                  result.success
                    ? "bg-green-500/10 text-green-500"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {result.success ? (
                  <>
                    <Check className="h-4 w-4" />
                    Connection successful
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    {result.error || "Connection failed"}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "configure" && (
            <>
              <Button variant="ghost" onClick={handleBack}>
                Back
              </Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!canSave || testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test"
                )}
              </Button>
              <Button onClick={handleSave} disabled={!canSave || saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Add Provider"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Provider Card
// ─────────────────────────────────────────────────────────────

const ProviderCard = memo(function ProviderCard({
  instance,
  onDelete,
}: {
  instance: LLMProviderInstance;
  onDelete: () => void;
}) {
  const preset = AI_PROVIDER_PRESETS.find((p) => p.id === instance.providerId);

  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{instance.name}</div>
        <div className="text-xs text-muted-foreground">
          {preset?.name || instance.providerId}
          {instance.apiKey && " · API key configured"}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {preset?.apiKeysURL && (
          <a
            href={preset.apiKeysURL}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-md hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

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
      <div className="border-b px-3 py-2 flex items-center justify-between">
        <div className="font-medium text-sm">AI Providers</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAddDialog(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>

      <ScrollArea className="flex-1 p-3">
        {instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="text-muted-foreground text-sm text-center">
              No providers configured
            </div>
            <Button variant="outline" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Provider
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
