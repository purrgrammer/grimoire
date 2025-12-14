import { useState, useMemo } from "react";
import { Copy, Check, Plus, X } from "lucide-react";
import {
  parseEncodeCommand,
  encodeToNostr,
  type ParsedEncodeCommand,
} from "@/lib/encode-parser";
import { useCopy } from "../hooks/useCopy";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { normalizeRelayURL } from "@/lib/relay-url";

interface EncodeViewerProps {
  args: string[];
}

export default function EncodeViewer({ args }: EncodeViewerProps) {
  const { copy, copied } = useCopy();
  const [relays, setRelays] = useState<string[]>([]);
  const [newRelay, setNewRelay] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Parse command
  const parsed = useMemo<ParsedEncodeCommand | null>(() => {
    try {
      const result = parseEncodeCommand(args);
      setRelays(result.relays || []);
      setError(null);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse error");
      return null;
    }
  }, [args]);

  // Generate bech32 with current relays
  const encoded = useMemo(() => {
    if (!parsed) return null;
    try {
      return encodeToNostr({
        ...parsed,
        relays: relays.length > 0 ? relays : undefined,
      });
    } catch {
      return null;
    }
  }, [parsed, relays]);

  const copyToClipboard = () => {
    if (encoded) {
      copy(encoded);
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

  if (error) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground p-4">
        <div className="text-destructive text-sm font-mono">{error}</div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="h-full w-full flex flex-col bg-background text-foreground p-4">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  const supportsRelays = ["nprofile", "nevent", "naddr"].includes(parsed.type);

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          ENCODE {parsed.type.toUpperCase()}
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Input Information */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-semibold">
            Input
          </div>
          <div className="bg-muted p-3 rounded font-mono text-xs break-all">
            {parsed.value}
          </div>
          {parsed.author && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Author</div>
              <div className="bg-muted p-2 rounded font-mono text-xs break-all">
                {parsed.author}
              </div>
            </div>
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

        {/* Encoded Result */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-semibold">
            Result
          </div>
          <div className="bg-muted p-3 rounded font-mono text-xs break-all border border-accent">
            {encoded}
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
      </div>
    </div>
  );
}
