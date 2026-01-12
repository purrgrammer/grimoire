import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, Plus, Settings2 } from "lucide-react";
import { normalizeURL } from "applesauce-core/helpers";

export interface RelaySelectorProps {
  /** Currently selected relays */
  selectedRelays: string[];
  /** Callback when relay selection changes */
  onRelaysChange: (relays: string[]) => void;
  /** Maximum number of relays to allow */
  maxRelays?: number;
}

/**
 * Relay selector component with connection status
 *
 * Features:
 * - Shows connection status for each relay
 * - Add/remove relays
 * - Visual indicator of selected relays
 * - Limit maximum relay count
 */
export function RelaySelector({
  selectedRelays,
  onRelaysChange,
  maxRelays = 10,
}: RelaySelectorProps) {
  const [newRelayUrl, setNewRelayUrl] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  // Handle add relay
  const handleAddRelay = useCallback(() => {
    if (!newRelayUrl.trim()) return;

    try {
      const normalized = normalizeURL(newRelayUrl.trim());

      if (selectedRelays.includes(normalized)) {
        alert("Relay already added");
        return;
      }

      if (selectedRelays.length >= maxRelays) {
        alert(`Maximum ${maxRelays} relays allowed`);
        return;
      }

      onRelaysChange([...selectedRelays, normalized]);
      setNewRelayUrl("");
    } catch (error) {
      alert("Invalid relay URL");
    }
  }, [newRelayUrl, selectedRelays, onRelaysChange, maxRelays]);

  // Handle remove relay
  const handleRemoveRelay = useCallback(
    (relay: string) => {
      onRelaysChange(selectedRelays.filter((r) => r !== relay));
    },
    [selectedRelays, onRelaysChange],
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Settings2 className="w-4 h-4" />
          Relays ({selectedRelays.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="end">
        <div className="flex flex-col h-[400px]">
          {/* Header */}
          <div className="p-4 border-b">
            <h4 className="font-medium mb-2">Select Relays</h4>
            <p className="text-xs text-muted-foreground">
              Choose which relays to publish to (max {maxRelays})
            </p>
          </div>

          {/* Selected Relays */}
          <ScrollArea className="flex-1 p-4">
            {selectedRelays.length > 0 ? (
              <div className="space-y-2">
                {selectedRelays.map((relay: string) => (
                  <div
                    key={relay}
                    className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono truncate">{relay}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleRemoveRelay(relay)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic py-4 text-center">
                No relays selected. Add relays below.
              </div>
            )}
          </ScrollArea>

          {/* Add Relay */}
          <div className="p-4 border-t">
            <div className="flex gap-2">
              <Input
                placeholder="wss://relay.example.com"
                value={newRelayUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewRelayUrl(e.target.value)
                }
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    handleAddRelay();
                  }
                }}
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleAddRelay}
                disabled={!newRelayUrl.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
