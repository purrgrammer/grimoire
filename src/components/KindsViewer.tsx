import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { getKindInfo } from "@/constants/kinds";
import { kindRenderers } from "./nostr/kinds";
import { NIPBadge } from "./NIPBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CenteredContent } from "./ui/CenteredContent";

// Dynamically derive supported kinds from renderer registry
const SUPPORTED_KINDS = Object.keys(kindRenderers).map(Number);

/**
 * KindsViewer - System introspection command
 * Shows all event kinds with rich rendering support
 */
export default function KindsViewer() {
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Autofocus on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Sort kinds in ascending order
  const sortedKinds = [...SUPPORTED_KINDS].sort((a, b) => a - b);

  // Filter kinds by search term (matches kind number or name)
  const filteredKinds = search
    ? sortedKinds.filter((kind) => {
        const kindInfo = getKindInfo(kind);
        const name = kindInfo?.name || "";
        const description = kindInfo?.description || "";
        const searchLower = search.toLowerCase();
        return (
          kind.toString().includes(search) ||
          name.toLowerCase().includes(searchLower) ||
          description.toLowerCase().includes(searchLower)
        );
      })
    : sortedKinds;

  // Clear search
  const handleClear = () => {
    setSearch("");
    searchInputRef.current?.focus();
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleClear();
    }
  };

  return (
    <CenteredContent>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2">
          {search
            ? `Showing ${filteredKinds.length} of ${sortedKinds.length} Kinds`
            : `Supported Event Kinds (${sortedKinds.length})`}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          Event kinds with rich rendering support in Grimoire. Default kinds
          display raw content only.
        </p>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef}
            type="text"
            placeholder="Search kinds by number or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-9 pr-9"
          />
          {search && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Kind List */}
      {filteredKinds.length > 0 ? (
        <div className="border border-border divide-y divide-border">
          {filteredKinds.map((kind) => {
            const kindInfo = getKindInfo(kind);
            const Icon = kindInfo?.icon;

            return (
              <div
                key={kind}
                className="p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-10 h-10 bg-accent/20 rounded flex items-center justify-center flex-shrink-0">
                    {Icon ? (
                      <Icon className="w-5 h-5 text-accent" />
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground">
                        {kind}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <code className="text-sm font-mono font-semibold">
                        {kind}
                      </code>
                      <span className="text-sm font-semibold">
                        {kindInfo?.name || `Kind ${kind}`}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {kindInfo?.description || "No description available"}
                    </p>
                    {kindInfo?.nip && <NIPBadge nipNumber={kindInfo.nip} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg mb-2">No kinds match "{search}"</p>
          <p className="text-sm">Try searching for a different term</p>
        </div>
      )}
    </CenteredContent>
  );
}
