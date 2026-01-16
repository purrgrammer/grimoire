/**
 * AIProviderSelector - Dropdown to select between multiple AI providers
 */

import { ChevronDown, Server } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import type { AIProvider } from "@/services/db";

interface AIProviderSelectorProps {
  providers: AIProvider[];
  activeProvider: AIProvider | null;
  onSelect: (provider: AIProvider) => void;
}

export function AIProviderSelector({
  providers,
  activeProvider,
  onSelect,
}: AIProviderSelectorProps) {
  if (providers.length <= 1) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton>
          <Server className="size-4" />
          <span className="truncate">
            {activeProvider?.name || "Select Provider"}
          </span>
          <ChevronDown className="size-4 ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {providers.map((provider) => (
          <DropdownMenuItem
            key={provider.id}
            onClick={() => onSelect(provider)}
            className={activeProvider?.id === provider.id ? "bg-muted" : ""}
          >
            {provider.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
