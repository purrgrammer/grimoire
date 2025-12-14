import { useState, memo, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Radio,
  FileText,
  Wifi,
  WifiOff,
  Loader2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Shield,
  Filter as FilterIcon,
  Download,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { useGrimoire } from "@/core/state";
import { useProfile } from "@/hooks/useProfile";
import { useRelayState } from "@/hooks/useRelayState";
import { FeedEvent } from "./nostr/Feed";
import { KindBadge } from "./KindBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { RelayLink } from "./nostr/RelayLink";
import type { NostrFilter } from "@/types/nostr";
import type { RelayState } from "@/types/relay-state";
import {
  formatEventIds,
  formatDTags,
  formatTimeRange,
  formatGenericTag,
  formatPubkeysWithProfiles,
  formatHashtags,
} from "@/lib/filter-formatters";
import { sanitizeFilename } from "@/lib/filename-utils";

// Memoized FeedEvent to prevent unnecessary re-renders during scroll
const MemoizedFeedEvent = memo(
  FeedEvent,
  (prev, next) => prev.event.id === next.event.id,
);

// Helper functions for relay status icons
function getConnectionIcon(relay: RelayState | undefined) {
  if (!relay) {
    return {
      icon: <WifiOff className="size-3 text-muted-foreground" />,
      label: "Unknown",
    };
  }

  const iconMap = {
    connected: {
      icon: <Wifi className="size-3 text-green-500" />,
      label: "Connected",
    },
    connecting: {
      icon: <Loader2 className="size-3 text-yellow-500 animate-spin" />,
      label: "Connecting",
    },
    disconnected: {
      icon: <WifiOff className="size-3 text-muted-foreground" />,
      label: "Disconnected",
    },
    error: {
      icon: <XCircle className="size-3 text-red-500" />,
      label: "Connection Error",
    },
  };
  return iconMap[relay.connectionState];
}

function getAuthIcon(relay: RelayState | undefined) {
  if (!relay || relay.authStatus === "none") {
    return null;
  }

  const iconMap = {
    authenticated: {
      icon: <ShieldCheck className="size-3 text-green-500" />,
      label: "Authenticated",
    },
    challenge_received: {
      icon: <ShieldQuestion className="size-3 text-yellow-500" />,
      label: "Challenge Received",
    },
    authenticating: {
      icon: <Loader2 className="size-3 text-yellow-500 animate-spin" />,
      label: "Authenticating",
    },
    failed: {
      icon: <ShieldX className="size-3 text-red-500" />,
      label: "Authentication Failed",
    },
    rejected: {
      icon: <ShieldAlert className="size-3 text-muted-foreground" />,
      label: "Authentication Rejected",
    },
    none: {
      icon: <Shield className="size-3 text-muted-foreground" />,
      label: "No Authentication",
    },
  };
  return iconMap[relay.authStatus] || iconMap.none;
}

interface ReqViewerProps {
  filter: NostrFilter;
  relays?: string[];
  closeOnEose?: boolean;
  nip05Authors?: string[];
  nip05PTags?: string[];
  title?: string;
}

interface QueryDropdownProps {
  filter: NostrFilter;
  nip05Authors?: string[];
  nip05PTags?: string[];
}

function QueryDropdown({
  filter,
  nip05Authors,
  nip05PTags,
}: QueryDropdownProps) {
  // Load profiles for authors and #p tags
  const authorPubkeys = filter.authors || [];
  const authorProfiles = authorPubkeys
    .slice(0, 10)
    .map((pubkey) => useProfile(pubkey));

  const pTagPubkeys = filter["#p"] || [];
  const pTagProfiles = pTagPubkeys
    .slice(0, 10)
    .map((pubkey) => useProfile(pubkey));

  // Extract tag filters
  const eTags = filter["#e"];
  const tTags = filter["#t"];
  const dTags = filter["#d"];

  // Find generic tags (exclude #e, #p, #t, #d)
  const genericTags = Object.entries(filter)
    .filter(
      ([key]) =>
        key.startsWith("#") &&
        key.length === 2 &&
        !["#e", "#p", "#t", "#d"].includes(key),
    )
    .map(([key, values]) => ({ letter: key[1], values: values as string[] }));

  return (
    <div className="border-b border-border px-4 py-2 bg-muted space-y-2">
      {/* Kinds */}
      {filter.kinds && filter.kinds.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">Kinds:</span>
          {filter.kinds.map((kind) => (
            <KindBadge
              key={kind}
              kind={kind}
              iconClassname="size-3"
              className="text-xs"
              clickable
            />
          ))}
        </div>
      )}

      {/* Time Range */}
      {(filter.since || filter.until) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">
            Time Range:
          </span>
          <span className="text-xs ml-2">
            {formatTimeRange(filter.since, filter.until)}
          </span>
        </div>
      )}

      {/* Search */}
      {filter.search && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">Search:</span>
          <span className="text-xs ml-2">"{filter.search}"</span>
        </div>
      )}

      {/* Authors */}
      {authorPubkeys.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-foreground">
            Authors: {authorPubkeys.length}
          </span>
          <div className="text-xs ml-2">
            {formatPubkeysWithProfiles(authorPubkeys, authorProfiles, 3)}
          </div>
          {nip05Authors && nip05Authors.length > 0 && (
            <div className="text-xs ml-2 mt-1 space-y-0.5">
              {nip05Authors.map((nip05) => (
                <div key={nip05}>→ {nip05}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tag Filters Section */}
      {(eTags ||
        pTagPubkeys.length > 0 ||
        tTags ||
        dTags ||
        genericTags.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">
            Tag Filters:
          </span>

          {/* Event References (#e) */}
          {eTags && eTags.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#e ({eTags.length}):</span>
              <span className="text-xs">{formatEventIds(eTags, 3)}</span>
            </div>
          )}

          {/* Mentions (#p) */}
          {pTagPubkeys.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#p ({pTagPubkeys.length}):</span>
              <span className="text-xs">
                {formatPubkeysWithProfiles(pTagPubkeys, pTagProfiles, 3)}
              </span>
              {nip05PTags && nip05PTags.length > 0 && (
                <div className="text-xs space-y-0.5">
                  {nip05PTags.map((nip05) => (
                    <div key={nip05}>→ {nip05}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Hashtags (#t) */}
          {tTags && tTags.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#t ({tTags.length}):</span>
              <span className="text-xs">{formatHashtags(tTags, 3)}</span>
            </div>
          )}

          {/* D-Tags (#d) */}
          {dTags && dTags.length > 0 && (
            <div className="flex flex-col">
              <span className="text-xs">#d ({dTags.length}):</span>
              <span className="text-xs">{formatDTags(dTags, 3)}</span>
            </div>
          )}

          {/* Generic Tags */}
          {genericTags.map((tag) => (
            <div key={tag.letter} className="flex flex-col">
              <span className="text-xs">
                #{tag.letter} ({tag.values.length}):
              </span>
              <span className="text-xs">
                {formatGenericTag(tag.letter, tag.values, 3).replace(
                  `#${tag.letter}: `,
                  "",
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Raw Query */}
      <details className="text-xs">
        <summary className="cursor-pointer">Show raw query</summary>
        <pre className="mt-2 text-xs font-mono bg-background p-2 border border-border overflow-x-auto">
          {JSON.stringify(filter, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function ReqViewer({
  filter,
  relays,
  closeOnEose = false,
  nip05Authors,
  nip05PTags,
  title = "nostr-events",
}: ReqViewerProps) {
  const { state } = useGrimoire();
  const { relays: relayStates } = useRelayState();

  // NIP-05 resolution already happened in argParser before window creation
  // The filter prop already contains resolved pubkeys
  // We just display the NIP-05 identifiers for user reference

  // Use inbox relays if logged in and no relays specified
  const defaultRelays =
    relays ||
    (state.activeAccount?.relays?.inbox.length
      ? state.activeAccount.relays.inbox.map((r) => r.url)
      : ["wss://theforest.nostr1.com"]);

  // Get relay state for each relay and calculate connected count
  const relayStatesForReq = defaultRelays.map((url) => ({
    url,
    state: relayStates[url],
  }));
  const connectedCount = relayStatesForReq.filter(
    (r) => r.state?.connectionState === "connected",
  ).length;

  // Streaming is the default behavior, closeOnEose inverts it
  const stream = !closeOnEose;

  const { events, loading, error, eoseReceived } = useReqTimeline(
    `req-${JSON.stringify(filter)}-${closeOnEose}`,
    filter,
    defaultRelays,
    { limit: filter.limit || 50, stream },
  );

  const [showQuery, setShowQuery] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFilename, setExportFilename] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  /**
   * Export events to JSONL format with chunked processing for large datasets
   * Handles tens of thousands of events without blocking the UI
   */
  const handleExport = useCallback(async () => {
    if (!exportFilename.trim()) return;

    setIsExporting(true);
    setExportProgress(0);

    try {
      const sanitized = sanitizeFilename(exportFilename);
      const CHUNK_SIZE = 1000; // Process 1000 events at a time
      const shouldChunk = events.length > CHUNK_SIZE;

      let blob: Blob;

      if (shouldChunk) {
        // Chunked processing for large datasets
        const chunks: string[] = [];

        for (let i = 0; i < events.length; i += CHUNK_SIZE) {
          // Yield to browser to prevent UI blocking
          await new Promise((resolve) => setTimeout(resolve, 0));

          const chunk = events.slice(i, i + CHUNK_SIZE);
          const jsonlChunk = chunk.map((e) => JSON.stringify(e)).join("\n");
          chunks.push(jsonlChunk);

          // Update progress
          setExportProgress(Math.round(((i + chunk.length) / events.length) * 100));
        }

        // Join chunks with newlines between them
        const jsonl = chunks.join("\n");
        blob = new Blob([jsonl], { type: "application/jsonl" });
      } else {
        // Direct processing for small datasets
        const jsonl = events.map((e) => JSON.stringify(e)).join("\n");
        blob = new Blob([jsonl], { type: "application/jsonl" });
      }

      // Create download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitized}.jsonl`;
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
  }, [events, exportFilename]);

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Compact Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
        {/* Left: Status Indicator */}
        <div className="flex items-center gap-2">
          <Radio
            className={`size-3 ${
              loading && !eoseReceived
                ? "text-yellow-500 animate-pulse"
                : loading && eoseReceived && stream
                  ? "text-green-500 animate-pulse"
                  : !loading && eoseReceived
                    ? "text-muted-foreground"
                    : "text-yellow-500 animate-pulse"
            }`}
          />
          <span
            className={`${
              loading && !eoseReceived
                ? "text-yellow-500"
                : loading && eoseReceived && stream
                  ? "text-green-500"
                  : !loading && eoseReceived
                    ? "text-muted-foreground"
                    : "text-yellow-500"
            } font-semibold`}
          >
            {loading && !eoseReceived
              ? "LOADING"
              : loading && eoseReceived && stream
                ? "LIVE"
                : !loading && eoseReceived
                  ? "CLOSED"
                  : "CONNECTING"}
          </span>
        </div>

        {/* Right: Stats */}
        <div className="flex items-center gap-3">
          {/* Event Count (Dropdown) */}
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
                  setExportFilename(title);
                  setShowExportDialog(true);
                }}
                disabled={events.length === 0}
              >
                <Download className="size-3 mr-2" />
                Export to JSONL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Relay Count (Dropdown) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <Wifi className="size-3" />
                <span>
                  {connectedCount}/{defaultRelays.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              {relayStatesForReq.map(({ url, state }) => {
                const connIcon = getConnectionIcon(state);
                const authIcon = getAuthIcon(state);

                return (
                  <DropdownMenuItem
                    key={url}
                    className="flex items-center justify-between gap-2"
                  >
                    <RelayLink
                      url={url}
                      showInboxOutbox={false}
                      className="flex-1 min-w-0 hover:bg-transparent"
                      iconClassname="size-3"
                      urlClassname="text-xs"
                    />
                    <div
                      className="flex items-center gap-1.5 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {authIcon && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">{authIcon.icon}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{authIcon.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help">{connIcon.icon}</div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{connIcon.label}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Query (Clickable) */}
          <button
            onClick={() => setShowQuery(!showQuery)}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            {showQuery ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <FilterIcon className="size-3" />
          </button>
        </div>
      </div>

      {/* Expandable Query */}
      {showQuery && (
        <QueryDropdown
          filter={filter}
          nip05Authors={nip05Authors}
          nip05PTags={nip05PTags}
        />
      )}

      {/* Error Display */}
      {error && (
        <div className="border-b border-border px-4 py-2 bg-destructive/10">
          <span className="text-xs font-mono text-destructive">
            Error: {error.message}
          </span>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading: Before EOSE received */}
        {loading && events.length === 0 && !eoseReceived && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            Loading events...
          </div>
        )}

        {/* EOSE received, no events, not streaming */}
        {eoseReceived && events.length === 0 && !stream && !error && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            No events found matching filter
          </div>
        )}

        {/* EOSE received, no events, streaming (live mode) */}
        {eoseReceived && events.length === 0 && stream && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            Listening for new events...
          </div>
        )}

        {events.length > 0 && (
          <Virtuoso
            style={{ height: "100%" }}
            data={events}
            computeItemKey={(_index, item) => item.id}
            itemContent={(_index, event) => <MemoizedFeedEvent event={event} />}
          />
        )}
      </div>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Events to JSONL</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {isExporting ? (
                <>
                  Exporting{" "}
                  <span className="font-semibold">{events.length}</span> event
                  {events.length !== 1 ? "s" : ""}...
                </>
              ) : (
                <>
                  Export <span className="font-semibold">{events.length}</span>{" "}
                  event{events.length !== 1 ? "s" : ""} as JSONL
                  (newline-delimited JSON).
                </>
              )}
            </div>
            {isExporting && events.length > 1000 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Processing events...</span>
                  <span>{exportProgress}%</span>
                </div>
                <Progress value={exportProgress} className="h-2" />
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="filename" className="text-sm font-medium">
                Filename
              </label>
              <Input
                id="filename"
                autoFocus
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder="Enter filename"
                disabled={isExporting}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && exportFilename.trim() && !isExporting) {
                    handleExport();
                  }
                }}
              />
              <div className="text-xs text-muted-foreground">
                .jsonl extension will be added automatically
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowExportDialog(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              disabled={!exportFilename.trim() || isExporting}
            >
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
    </div>
  );
}
