import { useState, useMemo } from "react";
import { Copy, Check, Plus, X, ExternalLink } from "lucide-react";
import {
  parseDecodeCommand,
  decodeNostr,
  reencodeWithRelays,
  type DecodedData,
} from "@/lib/decode-parser";
import { useGrimoire } from "@/core/state";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { KindBadge } from "./KindBadge";
import { normalizeRelayURL } from "@/lib/relay-url";

interface DecodeViewerProps {
  args: string[];
}

export default function DecodeViewer({ args }: DecodeViewerProps) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();
  const [relays, setRelays] = useState<string[]>([]);
  const [newRelay, setNewRelay] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Parse and decode
  const decoded = useMemo<{ bech32: string; data: DecodedData } | null>(() => {
    try {
      const parsed = parseDecodeCommand(args);
      const data = decodeNostr(parsed.bech32);

      // Initialize relays from decoded data
      if (data.type === "nprofile") {
        setRelays(data.data.relays || []);
      } else if (data.type === "nevent") {
        setRelays(data.data.relays || []);
      } else if (data.type === "naddr") {
        setRelays(data.data.relays || []);
      }

      setError(null);
      return { bech32: parsed.bech32, data };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Decode error");
      return null;
    }
  }, [args]);

  // Re-encode with current relays
  const reencoded = useMemo(() => {
    if (!decoded) return null;
    try {
      return reencodeWithRelays(decoded.data, relays, decoded.bech32);
    } catch {
      return decoded.bech32;
    }
  }, [decoded, relays]);

  const copyToClipboard = () => {
    if (reencoded) {
      copy(reencoded);
    }
  };

  const addRelay = () => {
    if (!newRelay.trim()) return;

    // Auto-add wss:// if no protocol
    let relayUrl = newRelay.trim();
    if (!relayUrl.startsWith("ws://") && !relayUrl.startsWith("wss://")) {
      relayUrl = `wss://${relayUrl}`;
    }

    try {
      const url = new URL(relayUrl);
      if (!url.protocol.startsWith("ws")) {
        setError("Relay must be a WebSocket URL (ws:// or wss://)");
        return;
      }
      setRelays([...relays, normalizeRelayURL(relayUrl)]);
      setNewRelay("");
      setError(null);
    } catch {
      setError("Invalid relay URL");
    }
  };

  const removeRelay = (index: number) => {
    setRelays(relays.filter((_, i) => i !== index));
  };

  const openEvent = () => {
    if (!decoded) return;
    if (decoded.data.type === "note") {
      addWindow(
        "open",
        { pointer: { id: decoded.data.data, relays } },
        `Event ${decoded.data.data.slice(0, 8)}...`,
      );
    } else if (decoded.data.type === "nevent") {
      addWindow(
        "open",
        { pointer: { id: decoded.data.data.id, relays } },
        `Event ${decoded.data.data.id.slice(0, 8)}...`,
      );
    } else if (decoded.data.type === "naddr") {
      const { kind, pubkey, identifier } = decoded.data.data;
      addWindow(
        "open",
        { pointer: { kind, pubkey, identifier, relays } },
        `${kind}:${pubkey.slice(0, 8)}:${identifier}`,
      );
    }
  };

  const openProfile = () => {
    if (!decoded) return;
    let pubkey: string | undefined;
    if (decoded.data.type === "npub") {
      pubkey = decoded.data.data;
    } else if (decoded.data.type === "nprofile") {
      pubkey = decoded.data.data.pubkey;
    } else if (decoded.data.type === "naddr") {
      pubkey = decoded.data.data.pubkey;
    }
    if (pubkey) {
      addWindow("profile", { pubkey }, `Profile ${pubkey.slice(0, 8)}...`);
    }
  };

  if (error) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground p-4">
        <div className="text-destructive text-sm font-mono">{error}</div>
      </div>
    );
  }

  if (!decoded) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground p-4">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  const { type, data } = decoded.data;
  const supportsRelays = ["nprofile", "nevent", "naddr"].includes(type);
  const canOpenEvent = ["note", "nevent", "naddr"].includes(type);
  const canOpenProfile = ["npub", "nprofile", "naddr"].includes(type);

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">DECODE {type.toUpperCase()}</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Decoded Information */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-semibold">
            Decoded Data
          </div>
          {type === "npub" && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Public Key</div>
              <div className="bg-muted p-3 rounded font-mono text-xs break-all">
                {data}
              </div>
            </div>
          )}
          {type === "note" && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Event ID</div>
              <div className="bg-muted p-3 rounded font-mono text-xs break-all">
                {data}
              </div>
            </div>
          )}
          {type === "nsec" && (
            <div className="space-y-1">
              <div className="text-xs text-destructive font-semibold">
                ⚠️ Private Key (Keep Secret!)
              </div>
              <div className="bg-destructive/10 p-3 rounded font-mono text-xs break-all border border-destructive">
                {data}
              </div>
            </div>
          )}
          {type === "nprofile" && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Public Key</div>
              <div className="bg-muted p-3 rounded font-mono text-xs break-all">
                {(data as any).pubkey}
              </div>
            </div>
          )}
          {type === "nevent" && (
            <>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Event ID</div>
                <div className="bg-muted p-3 rounded font-mono text-xs break-all">
                  {(data as any).id}
                </div>
              </div>
              {(data as any).author && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Author</div>
                  <div className="bg-muted p-2 rounded font-mono text-xs break-all">
                    {(data as any).author}
                  </div>
                </div>
              )}
            </>
          )}
          {type === "naddr" && (
            <>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Kind</div>
                <div className="bg-muted p-3 rounded text-xs">
                  <KindBadge
                    kind={(data as any).kind}
                    variant="full"
                    iconClassname="size-3 text-muted-foreground"
                    clickable
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Identifier</div>
                <div className="bg-muted p-3 rounded font-mono text-xs break-all">
                  {(data as any).identifier}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Public Key</div>
                <div className="bg-muted p-2 rounded font-mono text-xs break-all">
                  {(data as any).pubkey}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Relay Editor */}
        {supportsRelays && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground font-semibold">
              Relays ({relays.length})
            </div>
            <div className="space-y-2">
              {relays.map((relay, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1 bg-muted p-2 rounded font-mono text-xs truncate">
                    {relay}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeRelay(index)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="wss://relay.example.com"
                  value={newRelay}
                  onChange={(e) => setNewRelay(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRelay()}
                  className="font-mono text-xs"
                />
                <Button size="sm" onClick={addRelay}>
                  <Plus className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Updated Identifier */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-semibold">
            {supportsRelays && relays.length > 0
              ? "Updated Identifier"
              : "Original Identifier"}
          </div>
          <div className="bg-muted p-3 rounded font-mono text-xs break-all border border-accent">
            {reencoded}
          </div>
          <Button
            size="sm"
            onClick={copyToClipboard}
            className="w-full"
            variant={copied ? "default" : "outline"}
          >
            {copied ? (
              <>
                <Check className="size-3 mr-2" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="size-3 mr-2" />
                Copy to Clipboard
              </>
            )}
          </Button>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {canOpenEvent && (
            <Button
              size="sm"
              variant="outline"
              onClick={openEvent}
              className="flex-1"
            >
              <ExternalLink className="size-3 mr-2" />
              Open Event
            </Button>
          )}
          {canOpenProfile && (
            <Button
              size="sm"
              variant="outline"
              onClick={openProfile}
              className="flex-1"
            >
              <ExternalLink className="size-3 mr-2" />
              Open Profile
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
