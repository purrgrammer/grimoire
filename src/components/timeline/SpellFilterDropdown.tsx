import { useState } from "react";
import { Filter as FilterIcon, Code, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { CodeCopyButton } from "../CodeCopyButton";
import { SyntaxHighlight } from "../SyntaxHighlight";
import { useCopy } from "@/hooks/useCopy";
import { FilterSummaryBadges } from "../nostr/FilterSummaryBadges";
import type { NostrFilter, NostrEvent } from "@/types/nostr";

interface SpellFilterDropdownProps {
  filter: NostrFilter;
  spellEvent?: NostrEvent;
}

/**
 * SpellFilterDropdown - Reusable component for displaying spell filter with JSON preview
 * Shows spell event JSON and filter JSON with syntax highlighting
 */
export function SpellFilterDropdown({
  filter,
  spellEvent,
}: SpellFilterDropdownProps) {
  const { copy: handleCopy, copied } = useCopy();
  const [showSpellJson, setShowSpellJson] = useState(false);
  const [showFilterJson, setShowFilterJson] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <FilterIcon className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[600px] max-h-[600px] overflow-y-auto"
      >
        {/* Filter Summary Badges */}
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs font-semibold mb-2">Filter</div>
          <FilterSummaryBadges filter={filter} />
        </div>

        <div className="p-3 space-y-3">
          {/* Spell Event JSON (if published) */}
          {spellEvent && (
            <Collapsible open={showSpellJson} onOpenChange={setShowSpellJson}>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
                <Code className="size-3" />
                Spell Event JSON
                <ChevronDown
                  className={`size-3 ml-auto transition-transform ${showSpellJson ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="relative mt-2">
                  <SyntaxHighlight
                    code={JSON.stringify(spellEvent, null, 2)}
                    language="json"
                    className="bg-muted/50 p-3 pr-10 overflow-x-auto border border-border/40 rounded max-h-64"
                  />
                  <CodeCopyButton
                    onCopy={() =>
                      handleCopy(JSON.stringify(spellEvent, null, 2))
                    }
                    copied={copied}
                    label="Copy spell event JSON"
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Filter JSON */}
          <Collapsible open={showFilterJson} onOpenChange={setShowFilterJson}>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
              <Code className="size-3" />
              Filter JSON
              <ChevronDown
                className={`size-3 ml-auto transition-transform ${showFilterJson ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="relative mt-2">
                <SyntaxHighlight
                  code={JSON.stringify(filter, null, 2)}
                  language="json"
                  className="bg-muted/50 p-3 pr-10 overflow-x-auto border border-border/40 rounded max-h-64"
                />
                <CodeCopyButton
                  onCopy={() => handleCopy(JSON.stringify(filter, null, 2))}
                  copied={copied}
                  label="Copy filter JSON"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
