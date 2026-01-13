import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Copy, CopyCheck } from "lucide-react";
import { toast } from "sonner";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";
import type { ParsedSpellbook } from "@/types/spell";
import { relayListCache } from "@/services/relay-list-cache";

interface ShareSpellbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: NostrEvent;
  spellbook: ParsedSpellbook;
}

export function ShareSpellbookDialog({
  open,
  onOpenChange,
  event,
  spellbook,
}: ShareSpellbookDialogProps) {
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [naddr, setNaddr] = useState<string>("");

  const actor = nip19.npubEncode(event.pubkey);
  const webLink = `${window.location.origin}/${actor}/${spellbook.slug}`;

  useEffect(() => {
    const generateNaddr = async () => {
      const dTag = event.tags.find((t) => t[0] === "d")?.[1];
      if (!dTag) return;

      // Get relays from event or fallback to author's outbox relays
      let relays = event.tags.filter((t) => t[0] === "r").map((t) => t[1]);

      if (relays.length === 0) {
        const authorRelays = await relayListCache.getOutboxRelays(event.pubkey);
        if (authorRelays) {
          relays = authorRelays;
        }
      }

      try {
        const encoded = nip19.naddrEncode({
          kind: 30777,
          pubkey: event.pubkey,
          identifier: dTag,
          relays: relays.slice(0, 3),
        });
        setNaddr(encoded);
      } catch (e) {
        console.error("Failed to generate naddr:", e);
      }
    };

    if (open) {
      generateNaddr();
    }
  }, [event, open]);

  const handleCopy = (value: string, label: string) => {
    navigator.clipboard.writeText(value);
    setCopiedLink(label);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Share Spellbook</DialogTitle>
          <DialogDescription>
            Share "{spellbook.title}" with others
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Web Link */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Web Link
            </label>
            <div className="relative">
              <Input
                readOnly
                value={webLink}
                className="pr-10 font-mono text-xs bg-muted/50"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleCopy(webLink, "Link")}
                className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                {copiedLink === "Link" ? (
                  <CopyCheck className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Direct link to view this spellbook in Grimoire
            </p>
          </div>

          {/* Nostr ID (naddr) */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Nostr ID
            </label>
            <div className="relative">
              <Input
                readOnly
                value={naddr || "Generating..."}
                className="pr-10 font-mono text-xs bg-muted/50"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => naddr && handleCopy(naddr, "Nostr ID")}
                disabled={!naddr}
                className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
              >
                {copiedLink === "Nostr ID" ? (
                  <CopyCheck className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Universal identifier (naddr) for use in other Nostr clients
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
