import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Copy, Check, QrCode } from "lucide-react";
import { toast } from "sonner";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";
import type { ParsedSpellbook } from "@/types/spell";
import QRCodeLib from "qrcode";
import { useProfile } from "@/hooks/useProfile";

interface ShareFormat {
  id: string;
  label: string;
  description: string;
  getValue: (event: NostrEvent, spellbook: ParsedSpellbook, actor: string) => string;
}

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
  const profile = useProfile(event.pubkey);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [selectedFormat, setSelectedFormat] = useState<string>("web");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const actor = profile?.nip05 || nip19.npubEncode(event.pubkey);

  const formats: ShareFormat[] = [
    {
      id: "web",
      label: "Web Link",
      description: "Share as a web URL that anyone can open",
      getValue: (e, s, a) => `${window.location.origin}/preview/${a}/${s.slug}`,
    },
    {
      id: "naddr",
      label: "Nostr Address (naddr)",
      description: "NIP-19 address pointer for Nostr clients",
      getValue: (e, s) => {
        const dTag = e.tags.find((t) => t[0] === "d")?.[1];
        if (!dTag) return "";
        return nip19.naddrEncode({
          kind: 30777,
          pubkey: e.pubkey,
          identifier: dTag,
          relays: e.tags
            .filter((t) => t[0] === "r")
            .map((t) => t[1])
            .slice(0, 3),
        });
      },
    },
    {
      id: "nevent",
      label: "Nostr Event (nevent)",
      description: "NIP-19 event pointer with relay hints",
      getValue: (e) => {
        return nip19.neventEncode({
          id: e.id,
          kind: 30777,
          author: e.pubkey,
          relays: e.tags
            .filter((t) => t[0] === "r")
            .map((t) => t[1])
            .slice(0, 3),
        });
      },
    },
  ];

  const selectedFormatData = formats.find((f) => f.id === selectedFormat);
  const currentValue = selectedFormatData
    ? selectedFormatData.getValue(event, spellbook, actor)
    : "";

  // Generate QR code when selected format changes
  useEffect(() => {
    if (!canvasRef.current || !currentValue) return;

    QRCodeLib.toCanvas(canvasRef.current, currentValue, {
      width: 256,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    }).catch((err) => {
      console.error("QR code generation failed:", err);
    });

    // Also generate data URL for potential download
    QRCodeLib.toDataURL(currentValue, {
      width: 512,
      margin: 2,
    })
      .then((url) => setQrCodeUrl(url))
      .catch((err) => {
        console.error("QR data URL generation failed:", err);
      });
  }, [currentValue]);

  const handleCopy = (formatId: string) => {
    const format = formats.find((f) => f.id === formatId);
    if (!format) return;

    const value = format.getValue(event, spellbook, actor);
    if (!value) {
      toast.error("Failed to generate share link");
      return;
    }

    navigator.clipboard.writeText(value);
    setCopiedFormat(formatId);
    toast.success(`${format.label} copied to clipboard`);

    setTimeout(() => setCopiedFormat(null), 2000);
  };

  const handleDownloadQR = () => {
    if (!qrCodeUrl) return;

    const link = document.createElement("a");
    link.href = qrCodeUrl;
    link.download = `spellbook-${spellbook.slug}-qr.png`;
    link.click();
    toast.success("QR code downloaded");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Share Spellbook</DialogTitle>
          <DialogDescription>
            Share "{spellbook.title}" using any of the formats below
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Format Tabs */}
          <div className="flex gap-2 border-b border-border">
            {formats.map((format) => (
              <button
                key={format.id}
                onClick={() => setSelectedFormat(format.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  selectedFormat === format.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {format.label}
              </button>
            ))}
          </div>

          {/* Selected Format Content */}
          {selectedFormatData && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {selectedFormatData.description}
              </p>

              {/* Value Display with Copy Button */}
              <div className="flex gap-2">
                <div className="flex-1 rounded-lg border border-border bg-muted/50 p-3 font-mono text-sm break-all">
                  {currentValue}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(selectedFormat)}
                  className="flex-shrink-0"
                >
                  {copiedFormat === selectedFormat ? (
                    <Check className="size-4 text-green-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-4 p-6 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <QrCode className="size-4" />
                  QR Code
                </div>

                <canvas
                  ref={canvasRef}
                  className="rounded-lg border border-border bg-white p-2"
                />

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadQR}
                  className="w-full"
                >
                  Download QR Code
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Quick Copy All Formats */}
        <div className="border-t border-border pt-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Quick Copy
          </p>
          <div className="flex flex-wrap gap-2">
            {formats.map((format) => (
              <Button
                key={format.id}
                variant="secondary"
                size="sm"
                onClick={() => handleCopy(format.id)}
                className="flex items-center gap-2"
              >
                {copiedFormat === format.id ? (
                  <Check className="size-3 text-green-500" />
                ) : (
                  <Copy className="size-3" />
                )}
                {format.label}
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
