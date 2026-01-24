import { useState, useCallback } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { sanitizeFilename } from "@/lib/filename-utils";
import type { NostrEvent } from "@/types/nostr";

interface EventCountDropdownProps {
  events: NostrEvent[];
  defaultFilename?: string;
}

/**
 * EventCountDropdown - Reusable component for displaying event count with export option
 * Extracted from ReqViewer to be reusable across spell tabs and other components
 */
export function EventCountDropdown({
  events,
  defaultFilename = "nostr-events",
}: EventCountDropdownProps) {
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFilename, setExportFilename] = useState(defaultFilename);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const handleExport = useCallback(async () => {
    if (events.length === 0) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      // Sanitize filename
      const sanitized = sanitizeFilename(exportFilename || defaultFilename);
      const filename = `${sanitized}.jsonl`;

      let content: string;

      if (events.length > 10000) {
        // For large datasets, process in chunks with progress updates
        const chunks: string[] = [];
        const chunkSize = 1000;
        for (let i = 0; i < events.length; i += chunkSize) {
          const chunk = events.slice(i, i + chunkSize);
          chunks.push(chunk.map((e) => JSON.stringify(e)).join("\n"));
          setExportProgress((i / events.length) * 100);
        }
        content = chunks.join("\n");
      } else {
        // Direct processing for small datasets
        content = events.map((e) => JSON.stringify(e)).join("\n");
      }

      // Create File object (required for Share API)
      const file = new File([content], filename, {
        type: "application/jsonl",
      });

      // Try Share API first (mobile-friendly, native UX)
      if (
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function"
      ) {
        try {
          // Check if we can actually share files
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: "Export Nostr Events",
              text: `${events.length} event${events.length !== 1 ? "s" : ""}`,
            });

            // Success! Close dialog
            setExportProgress(100);
            setIsExporting(false);
            setExportProgress(0);
            setShowExportDialog(false);
            return;
          }
        } catch (err) {
          // User cancelled share dialog (AbortError) - just close silently
          if (err instanceof Error && err.name === "AbortError") {
            setIsExporting(false);
            setExportProgress(0);
            setShowExportDialog(false);
            return;
          }
          // Other errors - fall through to traditional download
          console.warn("Share API failed, falling back to download:", err);
        }
      }

      // Fallback: Traditional blob download (desktop browsers)
      const blob = new Blob([content], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportProgress(100);
    } catch (error) {
      console.error("Export failed:", error);
      // Keep dialog open on error so user can retry
      setIsExporting(false);
      setExportProgress(0);
      return;
    }

    // Close dialog on success
    setIsExporting(false);
    setExportProgress(0);
    setShowExportDialog(false);
  }, [events, exportFilename, defaultFilename]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`${events.length} event${events.length !== 1 ? "s" : ""}, click for export options`}
          >
            <FileText className="size-3" />
            <span>{events.length}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setExportFilename(defaultFilename);
              setShowExportDialog(true);
            }}
            disabled={events.length === 0}
          >
            <Download className="size-3 mr-2" />
            Export to JSONL
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Events</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Filename</label>
              <Input
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder="nostr-events"
                disabled={isExporting}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {events.length} event{events.length !== 1 ? "s" : ""} • JSONL
                format
              </p>
            </div>
            {isExporting && (
              <div>
                <Progress value={exportProgress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-2">
                  Exporting... {Math.round(exportProgress)}%
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="size-4 mr-2" />
                  Export
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
