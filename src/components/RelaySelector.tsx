import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, Plus, Wifi, WifiOff, Settings2 } from "lucide-react";
import { normalizeURL } from "applesauce-core/helpers";
import pool from "@/services/relay-pool";
import { use$ } from "applesauce-react/hooks";

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

  // Get relay pool stats
  const relayStats = use$(pool.stats$) || new Map();

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

  // Handle toggle relay
  const handleToggleRelay = useCallback(
    (relay: string) => {
      if (selectedRelays.includes(relay)) {
        handleRemoveRelay(relay);
      } else {
        if (selectedRelays.length >= maxRelays) {
          alert(`Maximum ${maxRelays} relays allowed`);
          return;
        }
        onRelaysChange([...selectedRelays, relay]);
      }
    },
    [selectedRelays, handleRemoveRelay, onRelaysChange, maxRelays],
  );

  // Get relay connection status
  const getRelayStatus = useCallback(
    (relay: string): "connected" | "connecting" | "disconnected" => {
      const stats = relayStats.get(relay);
      if (!stats) return "disconnected";

      // Check if there are any active subscriptions
      if (stats.connectionState === "open") return "connected";
      if (stats.connectionState === "connecting") return "connecting";
      return "disconnected";
    },
    [relayStats],
  );

  // Get all known relays from pool
  const knownRelays = Array.from(relayStats.keys());

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
          {selectedRelays.length > 0 && (
            <div className="p-4 border-b bg-muted/30">
              <div className="text-xs font-medium mb-2 text-muted-foreground">
                SELECTED ({selectedRelays.length})
              </div>
              <div className="space-y-2">
                {selectedRelays.map((relay: string) => (
                  <RelayItem
                    key={relay}
                    relay={relay}
                    status={getRelayStatus(relay)}
                    selected={true}
                    onToggle={() => {
                      handleRemoveRelay(relay);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Available Relays */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-2">
              <div className="text-xs font-medium mb-2 text-muted-foreground">
                AVAILABLE
              </div>
              {knownRelays
                .filter((relay: string) => !selectedRelays.includes(relay))
                .map((relay: string) => (
                  <RelayItem
                    key={relay}
                    relay={relay}
                    status={getRelayStatus(relay)}
                    selected={false}
                    onToggle={() => {
                      handleToggleRelay(relay);
                    }}
                  />
                ))}

              {knownRelays.filter((r: string) => !selectedRelays.includes(r))
                .length === 0 && (
                <div className="text-sm text-muted-foreground italic py-4 text-center">
                  No other relays available
                </div>
              )}
            </div>
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

/**
 * Individual relay item
 */
function RelayItem({
  relay,
  status,
  selected,
  onToggle,
}: {
  relay: string;
  status: "connected" | "connecting" | "disconnected";
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={onToggle}
    >
      {/* Status Indicator */}
      {status === "connected" && (
        <Wifi className="w-4 h-4 text-green-500 flex-shrink-0" />
      )}
      {status === "connecting" && (
        <Wifi className="w-4 h-4 text-yellow-500 flex-shrink-0 animate-pulse" />
      )}
      {status === "disconnected" && (
        <WifiOff className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      )}

      {/* Relay URL */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono truncate">{relay}</div>
      </div>

      {/* Selection Indicator */}
      {selected ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0 hover:bg-primary/10"
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
