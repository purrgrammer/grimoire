/**
 * Event Log Viewer
 *
 * Compact log of relay operations for debugging and introspection.
 */

import { useState, useCallback, useMemo } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
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
import { KindBadge } from "./KindBadge";
import { KindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";

// ============================================================================
// Tab Filters
// ============================================================================

type TabFilter = "all" | "publish" | "connect" | "auth" | "notice";

/** Map tab values to the EventLogType(s) they filter */
const TAB_TYPE_MAP: Record<TabFilter, EventLogType[] | undefined> = {
  all: undefined,
  publish: ["PUBLISH"],
  connect: ["CONNECT", "DISCONNECT"],
  auth: ["AUTH"],
  notice: ["NOTICE"],
};

const TAB_FILTERS: { value: TabFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "publish", label: "Publish" },
  { value: "connect", label: "Connect" },
  { value: "auth", label: "Auth" },
  { value: "notice", label: "Notice" },
];

// ============================================================================
// Shared row layout
// ============================================================================

function EntryRow({
  icon,
  tooltip,
  children,
  timestamp,
  className,
  expanded,
  onToggle,
  details,
}: {
  icon: React.ReactNode;
  tooltip: string;
  children: React.ReactNode;
  timestamp: number;
  className?: string;
  expanded?: boolean;
  onToggle?: () => void;
  details?: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1 border-b border-border min-w-0",
          onToggle && "cursor-pointer hover:bg-muted/50",
          className,
        )}
        onClick={onToggle}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex-shrink-0">{icon}</div>
          </TooltipTrigger>
          <TooltipContent side="right">{tooltip}</TooltipContent>
        </Tooltip>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs">
          {children}
        </div>
        <span className="flex-shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatTimestamp(timestamp / 1000, "relative")}
        </span>
        {onToggle && (
          <div className="flex-shrink-0 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
          </div>
        )}
      </div>
      {expanded && details && (
        <div className="pl-7 pr-2 py-2 space-y-2 bg-muted/30 border-b border-border text-xs">
          {details}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Entry Renderers
// ============================================================================

function PublishRelayRow({
  relay,
  status,
  onRetry,
}: {
  relay: string;
  status: { status: string; error?: string };
  onRetry?: () => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        {status.status === "success" && (
          <Check className="size-3 text-success flex-shrink-0" />
        )}
        {status.status === "error" && (
          <X className="size-3 text-destructive flex-shrink-0" />
        )}
        {(status.status === "pending" || status.status === "publishing") && (
          <Loader2 className="size-3 animate-spin text-muted-foreground flex-shrink-0" />
        )}
        <RelayLink
          url={relay}
          showInboxOutbox={false}
          className="flex-1 min-w-0"
        />
        {status.status === "error" && onRetry && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 text-[11px] px-1.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
          >
            <RotateCcw className="size-2.5 mr-0.5" />
            Retry
          </Button>
        )}
      </div>
      {status.error && (
        <div className="pl-[18px] text-[10px] text-destructive/80 break-words">
          {status.error}
        </div>
      )}
    </div>
  );
}

function PublishEntry({
  entry,
  onRetry,
  onRetryRelay,
}: {
  entry: PublishLogEntry;
  onRetry?: (entryId: string) => void;
  onRetryRelay?: (entryId: string, relay: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const statuses = Array.from(entry.relayStatus.values());
  const successCount = statuses.filter((s) => s.status === "success").length;
  const errorCount = statuses.filter((s) => s.status === "error").length;
  const isPending = statuses.some(
    (s) => s.status === "pending" || s.status === "publishing",
  );

  return (
    <EntryRow
      icon={<Send className="size-3.5 text-info" />}
      tooltip="Publish"
      timestamp={entry.timestamp}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      details={
        <>
          <div className="space-y-1">
            {Array.from(entry.relayStatus.entries()).map(([relay, status]) => (
              <PublishRelayRow
                key={relay}
                relay={relay}
                status={status}
                onRetry={
                  onRetryRelay ? () => onRetryRelay(entry.id, relay) : undefined
                }
              />
            ))}
          </div>
          <div className="rounded border border-border overflow-hidden">
            <EventErrorBoundary event={entry.event}>
              <KindRenderer event={entry.event} />
            </EventErrorBoundary>
          </div>
          {errorCount > 0 && onRetry && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(entry.id);
                }}
              >
                <RotateCcw className="size-3 mr-1" />
                Retry all ({errorCount})
              </Button>
            </div>
          )}
        </>
      }
    >
      <KindBadge
        kind={entry.event.kind}
        className="text-xs gap-1"
        iconClassname="size-3 text-muted-foreground"
      />
      {isPending && (
        <Loader2 className="size-3 animate-spin text-muted-foreground" />
      )}
      {!isPending && successCount > 0 && (
        <span className="text-success tabular-nums">{successCount} ok</span>
      )}
      {!isPending && errorCount > 0 && (
        <span className="text-destructive tabular-nums">{errorCount} fail</span>
      )}
    </EntryRow>
  );
}

function ConnectEntry({ entry }: { entry: ConnectLogEntry }) {
  const isConnect = entry.type === "CONNECT";

  return (
    <EntryRow
      icon={
        isConnect ? (
          <Wifi className="size-3.5 text-success" />
        ) : (
          <WifiOff className="size-3.5 text-destructive/70" />
        )
      }
      tooltip={isConnect ? "Connected" : "Disconnected"}
      timestamp={entry.timestamp}
    >
      <RelayLink url={entry.relay} showInboxOutbox={false} />
    </EntryRow>
  );
}

function AuthEntry({ entry }: { entry: AuthLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const statusTooltip: Record<string, string> = {
    challenge: "Auth challenge",
    success: "Auth success",
    failed: "Auth failed",
    rejected: "Auth rejected",
  };

  return (
    <EntryRow
      icon={
        entry.status === "success" ? (
          <Shield className="size-3.5 text-success" />
        ) : entry.status === "failed" ? (
          <ShieldAlert className="size-3.5 text-destructive" />
        ) : entry.status === "challenge" ? (
          <ShieldAlert className="size-3.5 text-warning" />
        ) : (
          <ShieldAlert className="size-3.5 text-muted-foreground" />
        )
      }
      tooltip={statusTooltip[entry.status] ?? "Auth"}
      timestamp={entry.timestamp}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      details={
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Status:</span>
            <span
              className={cn(
                entry.status === "success" && "text-success",
                entry.status === "failed" && "text-destructive",
                entry.status === "challenge" && "text-warning",
                entry.status === "rejected" && "text-muted-foreground",
              )}
            >
              {entry.status}
            </span>
          </div>
          {entry.challenge && (
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              challenge: {entry.challenge}
            </div>
          )}
        </div>
      }
    >
      <RelayLink url={entry.relay} showInboxOutbox={false} />
    </EntryRow>
  );
}

function NoticeEntry({ entry }: { entry: NoticeLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <EntryRow
      icon={<MessageSquare className="size-3.5 text-warning" />}
      tooltip="Notice"
      timestamp={entry.timestamp}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      details={
        <div className="text-muted-foreground break-words">{entry.message}</div>
      }
    >
      <RelayLink url={entry.relay} showInboxOutbox={false} />
    </EntryRow>
  );
}

function LogEntryRenderer({
  entry,
  onRetry,
  onRetryRelay,
}: {
  entry: LogEntry;
  onRetry?: (entryId: string) => void;
  onRetryRelay?: (entryId: string, relay: string) => void;
}) {
  switch (entry.type) {
    case "PUBLISH":
      return (
        <PublishEntry
          entry={entry}
          onRetry={onRetry}
          onRetryRelay={onRetryRelay}
        />
      );
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

  const filterTypes = useMemo(() => TAB_TYPE_MAP[activeTab], [activeTab]);
  const {
    entries,
    clear,
    retryFailedRelays,
    retryRelay,
    totalCount,
    typeCounts,
  } = useEventLog({
    types: filterTypes,
  });

  /** Get count for a tab filter */
  const getTabCount = useCallback(
    (tab: TabFilter): number => {
      const types = TAB_TYPE_MAP[tab];
      if (!types) return totalCount;
      return types.reduce((sum, t) => sum + (typeCounts[t] || 0), 0);
    },
    [totalCount, typeCounts],
  );

  const handleRetry = useCallback(
    async (entryId: string) => {
      await retryFailedRelays(entryId);
    },
    [retryFailedRelays],
  );

  const handleRetryRelay = useCallback(
    async (entryId: string, relay: string) => {
      await retryRelay(entryId, relay);
    },
    [retryRelay],
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border gap-2">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabFilter)}
        >
          <TabsList className="h-7">
            {TAB_FILTERS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs px-1.5 h-5 gap-1"
              >
                {tab.label}
                {getTabCount(tab.value) > 0 && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {getTabCount(tab.value)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          size="sm"
          variant="ghost"
          className="size-6 p-0 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
          onClick={clear}
          title="Clear log"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p className="text-xs">No events logged yet</p>
          </div>
        ) : (
          entries.map((entry) => (
            <LogEntryRenderer
              key={entry.id}
              entry={entry}
              onRetry={handleRetry}
              onRetryRelay={handleRetryRelay}
            />
          ))
        )}
      </div>
    </div>
  );
}
