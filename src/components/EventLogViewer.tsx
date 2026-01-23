/**
 * Event Log Viewer
 *
 * Displays a log of relay operations for debugging and introspection:
 * - PUBLISH events with per-relay status and retry functionality
 * - CONNECT/DISCONNECT events
 * - AUTH events
 * - NOTICE events
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Check,
  X,
  Loader2,
  Wifi,
  WifiOff,
  Shield,
  ShieldAlert,
  MessageSquare,
  Send,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { RelayLink } from "./nostr/RelayLink";
import { useEventLog } from "@/hooks/useEventLog";
import {
  type LogEntry,
  type EventLogType,
  type PublishLogEntry,
  type ConnectLogEntry,
  type AuthLogEntry,
  type NoticeLogEntry,
} from "@/services/event-log";
import { formatTimestamp } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

// ============================================================================
// Tab Filter Types
// ============================================================================

type TabFilter = "all" | EventLogType;

const TAB_FILTERS: { value: TabFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "PUBLISH", label: "Publish" },
  { value: "CONNECT", label: "Connect" },
  { value: "AUTH", label: "Auth" },
  { value: "NOTICE", label: "Notice" },
];

// ============================================================================
// Entry Renderers
// ============================================================================

interface EntryProps {
  entry: LogEntry;
  onRetry?: (entryId: string) => void;
}

function PublishEntry({
  entry,
  onRetry,
}: EntryProps & { entry: PublishLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const successCount = Array.from(entry.relayStatus.values()).filter(
    (s) => s.status === "success",
  ).length;
  const errorCount = Array.from(entry.relayStatus.values()).filter(
    (s) => s.status === "error",
  ).length;
  const pendingCount = Array.from(entry.relayStatus.values()).filter(
    (s) => s.status === "pending" || s.status === "publishing",
  ).length;

  const hasFailures = errorCount > 0;
  const isPending = pendingCount > 0;

  // Truncate event content for preview
  const contentPreview =
    entry.event.content.length > 60
      ? entry.event.content.slice(0, 60) + "..."
      : entry.event.content;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        className="w-full flex items-start gap-2 p-2 hover:bg-muted/50 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
        )}

        <Send className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(entry.timestamp / 1000, "time")}
            </span>
            <span className="font-medium">PUBLISH</span>
            <span className="text-xs text-muted-foreground">
              kind:{entry.event.kind}
            </span>
            {isPending && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
            {!isPending && successCount > 0 && (
              <span className="text-xs text-green-500">
                {successCount}/{entry.relays.length}
              </span>
            )}
            {!isPending && errorCount > 0 && (
              <span className="text-xs text-red-500">{errorCount} failed</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground truncate">
            {contentPreview || "(empty content)"}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="pl-10 pr-2 pb-2 space-y-2">
          {/* Relay status list */}
          <div className="space-y-1">
            {Array.from(entry.relayStatus.entries()).map(([relay, status]) => (
              <div key={relay} className="flex items-center gap-2 text-sm">
                {status.status === "success" && (
                  <Check className="h-3 w-3 text-green-500" />
                )}
                {status.status === "error" && (
                  <X className="h-3 w-3 text-red-500" />
                )}
                {(status.status === "pending" ||
                  status.status === "publishing") && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                <RelayLink
                  url={relay}
                  write={true}
                  showInboxOutbox={false}
                  className="text-xs"
                />
                {status.error && (
                  <span className="text-xs text-red-500 truncate">
                    {status.error}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Retry button for failed relays */}
          {hasFailures && onRetry && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onRetry(entry.id);
              }}
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Retry failed ({errorCount})
            </Button>
          )}

          {/* Event ID */}
          <div className="text-xs text-muted-foreground font-mono">
            {entry.event.id.slice(0, 16)}...
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectEntry({ entry }: EntryProps & { entry: ConnectLogEntry }) {
  const isConnect = entry.type === "CONNECT";

  return (
    <div className="flex items-center gap-2 p-2 border-b border-border last:border-b-0">
      {isConnect ? (
        <Wifi className="h-4 w-4 text-green-500" />
      ) : (
        <WifiOff className="h-4 w-4 text-muted-foreground" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(entry.timestamp / 1000, "time")}
          </span>
          <span
            className={cn(
              "font-medium",
              isConnect ? "text-green-500" : "text-muted-foreground",
            )}
          >
            {entry.type}
          </span>
        </div>
        <RelayLink
          url={entry.relay}
          write={true}
          showInboxOutbox={false}
          className="text-sm"
        />
      </div>
    </div>
  );
}

function AuthEntry({ entry }: EntryProps & { entry: AuthLogEntry }) {
  const statusColors = {
    challenge: "text-yellow-500",
    success: "text-green-500",
    failed: "text-red-500",
    rejected: "text-muted-foreground",
  };

  return (
    <div className="flex items-center gap-2 p-2 border-b border-border last:border-b-0">
      {entry.status === "success" ? (
        <Shield className="h-4 w-4 text-green-500" />
      ) : (
        <ShieldAlert className={cn("h-4 w-4", statusColors[entry.status])} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(entry.timestamp / 1000, "time")}
          </span>
          <span className="font-medium">AUTH</span>
          <span className={cn("text-xs", statusColors[entry.status])}>
            {entry.status}
          </span>
        </div>
        <RelayLink
          url={entry.relay}
          write={true}
          showInboxOutbox={false}
          className="text-sm"
        />
      </div>
    </div>
  );
}

function NoticeEntry({ entry }: EntryProps & { entry: NoticeLogEntry }) {
  return (
    <div className="flex items-start gap-2 p-2 border-b border-border last:border-b-0">
      <MessageSquare className="h-4 w-4 mt-0.5 text-amber-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(entry.timestamp / 1000, "time")}
          </span>
          <span className="font-medium text-amber-500">NOTICE</span>
        </div>
        <RelayLink
          url={entry.relay}
          write={true}
          showInboxOutbox={false}
          className="text-sm"
        />
        <div className="text-sm text-muted-foreground mt-1 break-words">
          {entry.message}
        </div>
      </div>
    </div>
  );
}

function LogEntryRenderer({ entry, onRetry }: EntryProps) {
  switch (entry.type) {
    case "PUBLISH":
      return <PublishEntry entry={entry} onRetry={onRetry} />;
    case "CONNECT":
    case "DISCONNECT":
      return <ConnectEntry entry={entry as ConnectLogEntry} />;
    case "AUTH":
      return <AuthEntry entry={entry as AuthLogEntry} />;
    case "NOTICE":
      return <NoticeEntry entry={entry as NoticeLogEntry} />;
    default:
      return null;
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function EventLogViewer() {
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filterTypes = activeTab === "all" ? undefined : [activeTab];
  const { entries, clear, retryFailedRelays, totalCount } = useEventLog({
    types: filterTypes,
  });

  // Auto-scroll to top when new entries arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length, autoScroll]);

  // Pause auto-scroll when user scrolls down
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop } = scrollRef.current;
      // If user scrolls down more than 50px, pause auto-scroll
      setAutoScroll(scrollTop < 50);
    }
  }, []);

  const handleRetry = useCallback(
    async (entryId: string) => {
      await retryFailedRelays(entryId);
    },
    [retryFailedRelays],
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabFilter)}
        >
          <TabsList className="h-8">
            {TAB_FILTERS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs px-2"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {entries.length}
            {totalCount !== entries.length && ` / ${totalCount}`} entries
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={clear}
            title="Clear log"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No events logged yet</p>
              <p className="text-xs mt-1">
                Events will appear here as you interact with relays
              </p>
            </div>
          </div>
        ) : (
          <div>
            {entries.map((entry) => (
              <LogEntryRenderer
                key={entry.id}
                entry={entry}
                onRetry={handleRetry}
              />
            ))}
          </div>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && entries.length > 0 && (
        <div className="absolute bottom-4 right-4">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAutoScroll(true);
              if (scrollRef.current) {
                scrollRef.current.scrollTop = 0;
              }
            }}
          >
            <ChevronDown className="h-3 w-3 mr-1" />
            New events
          </Button>
        </div>
      )}
    </div>
  );
}
