import { useState, memo } from "react";
import {
  List,
  Terminal,
  Wifi,
  Activity,
  FileText,
  ChevronRight,
  ChevronDown,
  GalleryVertical,
} from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { RelayLink } from "@/components/nostr/RelayLink";
import { FeedEvent } from "@/components/nostr/Feed";
import { MemoizedCompactEventRow } from "@/components/nostr/CompactEventRow";
import { CopyableJsonViewer } from "@/components/JsonViewer";
import type { NostrEvent } from "@/types/nostr";
import type { TraceEntry, SubscriptionInfo } from "@/lib/scroll-runtime";

function TraceRow({ entry }: { entry: TraceEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = entry.args || entry.result;

  return (
    <div className="border-b border-border/50">
      <div
        className={`flex items-center gap-1.5 text-xs font-mono px-2 py-1 ${hasDetail ? "cursor-pointer hover:bg-muted/30" : ""}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {hasDetail ? (
          expanded ? (
            <ChevronDown className="size-3 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 flex-shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <span
          className={`font-semibold ${entry.direction === "program" ? "text-highlight" : "text-accent"}`}
        >
          {entry.direction === "program" ? "program" : "host"}
        </span>
        <span className="text-foreground">{entry.fn}</span>
      </div>
      {expanded && hasDetail && (
        <div className="pl-7 pr-2 pb-2">
          <CopyableJsonViewer
            json={JSON.stringify(
              {
                ...(entry.args && { args: entry.args }),
                ...(entry.result && { result: entry.result }),
              },
              null,
              2,
            )}
          />
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <p className="text-xs">{message}</p>
    </div>
  );
}

interface ScrollOutputProps {
  displayedEvents: NostrEvent[];
  logEntries: string[];
  traceEntries: TraceEntry[];
  activeSubs: SubscriptionInfo[];
  eventCount: number;
  isActive: boolean;
}

const MemoizedFeedEvent = memo(
  FeedEvent,
  (prev, next) => prev.event.id === next.event.id,
);

export function ScrollOutput({
  displayedEvents,
  logEntries,
  traceEntries,
  activeSubs,
  eventCount,
  isActive,
}: ScrollOutputProps) {
  const [compact, setCompact] = useState(false);
  const openSubsCount = activeSubs.filter((s) => !s.closed).length;

  return (
    <Tabs defaultValue="results" className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center border-b border-border">
        <TabsList className="h-auto bg-transparent p-0 rounded-none">
          <TabsTrigger
            value="results"
            className="gap-2 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-foreground data-[state=active]:shadow-none"
          >
            <List className="size-3" />
            Results
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="gap-2 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-foreground data-[state=active]:shadow-none"
          >
            <Terminal className="size-3" />
            Logs
          </TabsTrigger>
          <TabsTrigger
            value="subs"
            className="gap-2 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-foreground data-[state=active]:shadow-none"
          >
            <Wifi className="size-3" />
            Subs
          </TabsTrigger>
          <TabsTrigger
            value="trace"
            className="gap-2 rounded-none border-b-2 border-transparent text-xs data-[state=active]:border-foreground data-[state=active]:shadow-none"
          >
            <Activity className="size-3" />
            Trace
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="results"
        className="flex-1 min-h-0 mt-0 flex flex-col"
      >
        <div className="flex items-center px-2 py-1 border-b border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-3 ml-auto">
            <span className="flex items-center gap-1">
              <Wifi className="size-3" />
              {openSubsCount}
            </span>
            <span className="flex items-center gap-1">
              <FileText className="size-3" />
              {eventCount}
            </span>
            <span className="flex items-center gap-1">
              <List className="size-3" />
              {displayedEvents.length}
            </span>
            <button
              onClick={() => setCompact((v) => !v)}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
              title={compact ? "Switch to list view" : "Switch to compact view"}
            >
              {compact ? (
                <GalleryVertical className="size-3" />
              ) : (
                <List className="size-3" />
              )}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {displayedEvents.length === 0 ? (
            <EmptyState
              message={
                isActive
                  ? "Waiting for results..."
                  : "Run the scroll to see results"
              }
            />
          ) : (
            <Virtuoso
              style={{ height: "100%" }}
              data={displayedEvents}
              computeItemKey={(_index, ev) => ev.id}
              itemContent={(_index, ev) =>
                compact ? (
                  <MemoizedCompactEventRow event={ev} />
                ) : (
                  <MemoizedFeedEvent event={ev} />
                )
              }
            />
          )}
        </div>
      </TabsContent>

      <TabsContent value="logs" className="flex-1 min-h-0 mt-0">
        {logEntries.length === 0 ? (
          <EmptyState
            message={isActive ? "Waiting for logs..." : "No log output"}
          />
        ) : (
          <Virtuoso
            style={{ height: "100%" }}
            data={logEntries}
            followOutput="smooth"
            computeItemKey={(index) => index}
            itemContent={(_index, entry) => (
              <div className="text-xs font-mono px-2 py-0.5 border-b border-border/50 whitespace-pre-wrap break-all">
                {entry}
              </div>
            )}
          />
        )}
      </TabsContent>

      <TabsContent value="subs" className="flex-1 min-h-0 mt-0">
        {activeSubs.length === 0 ? (
          <EmptyState
            message={
              isActive
                ? "No active subscriptions"
                : "Run the scroll to see subscriptions"
            }
          />
        ) : (
          <div className="overflow-auto h-full p-2 flex flex-col gap-2">
            {[...activeSubs]
              .sort((a, b) => a.handle - b.handle)
              .map((sub) => (
                <div
                  key={sub.handle}
                  className="border border-border/50 rounded p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono font-semibold">
                      SUB #{sub.handle}
                    </span>
                    <Label size="sm">{sub.eventCount} events</Label>
                    {sub.eosed && <Label size="sm">EOSE</Label>}
                    <span
                      className={`ml-auto flex items-center gap-1 ${sub.closed ? "text-muted-foreground" : "text-green-400"}`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${sub.closed ? "bg-muted-foreground" : "bg-green-400"}`}
                      />
                      {sub.closed ? "closed" : "open"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Filter:</span>
                    <pre className="mt-1 text-[11px] font-mono bg-muted/30 rounded p-1.5 overflow-x-auto">
                      {JSON.stringify(sub.filter, null, 2)}
                    </pre>
                  </div>
                  {sub.relays.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Relays ({sub.relays.length}):
                      </span>
                      <div className="flex flex-col gap-0.5">
                        {sub.relays.map((url) => (
                          <RelayLink key={url} url={url} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="trace" className="flex-1 min-h-0 mt-0">
        {traceEntries.length === 0 ? (
          <EmptyState
            message={isActive ? "Waiting for trace data..." : "No trace data"}
          />
        ) : (
          <Virtuoso
            style={{ height: "100%" }}
            data={traceEntries}
            followOutput="smooth"
            computeItemKey={(index) => index}
            itemContent={(_index, entry) => <TraceRow entry={entry} />}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
