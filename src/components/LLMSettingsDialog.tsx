/**
 * LLM Settings Dialog
 * Configure provider, API key, and model settings
 */

import { useState, useEffect } from "react";
import { Settings, ExternalLink, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";
import {
  getAvailableProviders,
  loadProviderConfig,
  saveProviderConfig,
  type ProviderConfig,
} from "@/lib/llm/provider-manager";

interface LLMSettingsDialogProps {
  onSettingsChange: (config: ProviderConfig) => void;
}

export function LLMSettingsDialog({
  onSettingsChange,
}: LLMSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ProviderConfig>(loadProviderConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const providers = getAvailableProviders();
  const currentProvider = providers.find((p) => p.id === config.providerId);

  useEffect(() => {
    // Load config when dialog opens
    if (open) {
      setConfig(loadProviderConfig());
      setHasChanges(false);
    }
  }, [open]);

  const handleProviderChange = (providerId: string) => {
    setConfig((prev) => ({
      ...prev,
      providerId,
      apiKey: prev.providerId === providerId ? prev.apiKey : "",
    }));
    setHasChanges(true);
  };

  const handleApiKeyChange = (apiKey: string) => {
    setConfig((prev) => ({ ...prev, apiKey }));
    setHasChanges(true);
  };

  const handleSave = () => {
    // Validate
    if (currentProvider?.requiresAuth && !config.apiKey) {
      toast.error("API key is required for this provider");
      return;
    }

    // Save config
    saveProviderConfig(config);
    onSettingsChange(config);
    setOpen(false);
    setHasChanges(false);
    toast.success("Settings saved");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7">
          <Settings className="size-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>LLM Provider Settings</DialogTitle>
          <DialogDescription>
            Configure your AI provider and API key. Your settings are stored
            locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label htmlFor="provider">Provider</label>
            <Select
              value={config.providerId}
              onValueChange={handleProviderChange}
            >
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                    {provider.requiresAuth && (
                      <span className="text-muted-foreground ml-2">
                        (requires API key)
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentProvider && (
              <p className="text-xs text-muted-foreground">
                {currentProvider.models.length} models available
                {currentProvider.baseUrl && ` • ${currentProvider.baseUrl}`}
              </p>
            )}
          </div>

          {/* API Key Input (only for providers that require auth) */}
          {currentProvider?.requiresAuth && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="apiKey">API Key</label>
                {config.providerId === "ppq" && (
                  <a
                    href="https://ppq.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Get API key
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showApiKey ? "text" : "password"}
                  value={config.apiKey || ""}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder="sk-..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {config.providerId === "ppq" && (
                <p className="text-xs text-muted-foreground">
                  PPQ offers pay-per-use pricing starting at 10¢. Average cost:
                  ~2¢ per query.
                </p>
              )}
            </div>
          )}

          {/* Default Model Info */}
          {currentProvider && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="text-sm font-medium">Recommended Model</div>
              <div className="text-xs text-muted-foreground">
                {currentProvider.models[0]?.name || "No models available"}
              </div>
              {currentProvider.models[0] && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>
                    Context:{" "}
                    {currentProvider.models[0].contextWindow.toLocaleString()}{" "}
                    tokens
                  </div>
                  {currentProvider.models[0].inputCostPer1k !== undefined && (
                    <div>
                      Cost: ${currentProvider.models[0].inputCostPer1k}/1K
                      input, ${currentProvider.models[0].outputCostPer1k}/1K
                      output
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges}>
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
