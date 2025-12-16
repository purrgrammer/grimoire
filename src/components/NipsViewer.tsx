import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { VALID_NIPS, NIP_TITLES } from "@/constants/nips";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NIPBadge } from "./NIPBadge";
import { useGrimoire } from "@/core/state";

/**
 * NipsViewer - Documentation introspection command
 * Shows all Nostr Implementation Possibilities (NIPs)
 */
export default function NipsViewer() {
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { addWindow } = useGrimoire();

  // Autofocus on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Sort NIPs: numeric first (01-99), then hex (7D, A0, etc.)
  const sortedNips = [...VALID_NIPS].sort((a, b) => {
    const aIsHex = /^[A-F]/.test(a);
    const bIsHex = /^[A-F]/.test(b);

    // If both are hex or both are numeric, sort alphabetically
    if (aIsHex === bIsHex) {
      return a.localeCompare(b);
    }

    // Numeric before hex
    return aIsHex ? 1 : -1;
  });

  // Filter NIPs by search term (matches NIP number or title)
  const filteredNips = search
    ? sortedNips.filter((nipId) => {
        const title = NIP_TITLES[nipId] || "";
        const searchLower = search.toLowerCase();
        return (
          nipId.toLowerCase().includes(searchLower) ||
          title.toLowerCase().includes(searchLower)
        );
      })
    : sortedNips;

  // Clear search
  const handleClear = () => {
    setSearch("");
    searchInputRef.current?.focus();
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      handleClear();
    } else if (e.key === "Enter" && filteredNips.length === 1) {
      // Open the single result when Enter is pressed
      const nipId = filteredNips[0];
      addWindow("nip", { number: nipId });
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold mb-2">
            {search
              ? `Showing ${filteredNips.length} of ${sortedNips.length} NIPs`
              : `Nostr Implementation Possibilities (${sortedNips.length})`}
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            Protocol specifications and extensions for the Nostr network. Click
            any NIP to view its full specification document.
          </p>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search NIPs by number or title..."
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

        {/* NIP List */}
        {filteredNips.length > 0 ? (
          <div className="flex flex-col gap-0">
            {filteredNips.map((nipId) => (
              <NIPBadge
                className="border-none"
                key={nipId}
                showName
                nipNumber={nipId}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg mb-2">No NIPs match "{search}"</p>
            <p className="text-sm">Try searching for a different term</p>
          </div>
        )}
      </div>
    </div>
  );
}
