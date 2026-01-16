/**
 * AIModelSelector - Dropdown to select AI model
 */

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface AIModelSelectorProps {
  models: string[];
  selectedModel: string;
  onSelect: (model: string) => void;
}

export function AIModelSelector({
  models,
  selectedModel,
  onSelect,
}: AIModelSelectorProps) {
  if (models.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">No models available</span>
    );
  }

  // Truncate long model names for display
  const displayModel =
    selectedModel.length > 30
      ? selectedModel.slice(0, 27) + "..."
      : selectedModel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs font-mono"
        >
          {displayModel || "Select model"}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
        {models.map((model) => (
          <DropdownMenuItem
            key={model}
            onClick={() => onSelect(model)}
            className={`font-mono text-xs ${selectedModel === model ? "bg-muted" : ""}`}
          >
            {model}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
