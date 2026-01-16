/**
 * AIModelSelector - Dropdown to select AI model with grouping
 */

import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useMemo } from "react";

interface AIModelSelectorProps {
  models: string[];
  selectedModel: string;
  onSelect: (model: string) => void;
}

/**
 * Group models by provider/family prefix
 */
function groupModels(models: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const model of models) {
    // Extract provider prefix (e.g., "claude", "gpt", "gemini")
    let group = "Other";

    if (model.startsWith("claude-")) {
      group = "Claude";
    } else if (model.startsWith("gpt-")) {
      group = "GPT";
    } else if (model.startsWith("o1") || model.startsWith("o3")) {
      group = "OpenAI o-series";
    } else if (model.startsWith("gemini-")) {
      group = "Gemini";
    } else if (model.startsWith("llama-") || model.includes("llama")) {
      group = "Llama";
    } else if (model.startsWith("mistral-") || model.includes("mistral")) {
      group = "Mistral";
    } else if (model.startsWith("deepseek-") || model.includes("deepseek")) {
      group = "DeepSeek";
    } else if (model.startsWith("qwen-") || model.includes("qwen")) {
      group = "Qwen";
    }

    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(model);
  }

  return groups;
}

/**
 * Get display name for a model (strip common prefixes)
 */
function getModelDisplayName(model: string): string {
  // Remove common prefixes for cleaner display
  return model
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/^gemini-/, "")
    .replace(/^llama-/, "")
    .replace(/^mistral-/, "")
    .replace(/^deepseek-/, "")
    .replace(/^qwen-/, "");
}

export function AIModelSelector({
  models,
  selectedModel,
  onSelect,
}: AIModelSelectorProps) {
  const groupedModels = useMemo(() => groupModels(models), [models]);

  if (models.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No models available</span>
    );
  }

  // Truncate long model names for display
  const displayModel =
    selectedModel.length > 25
      ? selectedModel.slice(0, 22) + "..."
      : selectedModel;

  // Preferred group order
  const groupOrder = [
    "Claude",
    "GPT",
    "OpenAI o-series",
    "Gemini",
    "DeepSeek",
    "Llama",
    "Mistral",
    "Qwen",
    "Other",
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs font-mono max-w-48"
        >
          <span className="truncate">{displayModel || "Select model"}</span>
          <ChevronDown className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 overflow-auto w-64"
      >
        {groupOrder.map((groupName, groupIndex) => {
          const groupModels = groupedModels.get(groupName);
          if (!groupModels || groupModels.length === 0) return null;

          return (
            <div key={groupName}>
              {groupIndex > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {groupName}
              </DropdownMenuLabel>
              {groupModels.map((model) => (
                <DropdownMenuItem
                  key={model}
                  onClick={() => onSelect(model)}
                  className="font-mono text-xs flex items-center justify-between"
                >
                  <span className="truncate">{getModelDisplayName(model)}</span>
                  {selectedModel === model && (
                    <Check className="size-3 shrink-0 ml-2" />
                  )}
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
