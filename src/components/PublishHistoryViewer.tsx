import { useMemo, useState } from "react";
import {
  Check,
  X,
  Clock,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { usePublishing } from "@/hooks/usePublishing";
import { Button } from "./ui/button";
import { RelayLink } from "./nostr/RelayLink";
import { formatDistanceToNow } from "date-fns";
import type { SignRequest, PublishRequest } from "@/types/publishing";

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <Check className="h-4 w-4 text-green-500" />;
    case "failed":
      return <X className="h-4 w-4 text-red-500" />;
    case "partial":
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "pending":
      return <Clock className="h-4 w-4 text-muted-foreground animate-pulse" />;
    default:
      return null;
  }
}

function SignRequestRow({ request }: { request: SignRequest }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 py-2 px-3 hover:bg-muted/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <StatusIcon status={request.status} />
        <span className="font-mono text-sm">
          Kind {request.unsignedEvent.kind}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatDistanceToNow(request.timestamp, { addSuffix: true })}
        </span>
        {request.duration && (
          <span className="text-muted-foreground text-xs ml-auto">
            {request.duration}ms
          </span>
        )}
      </div>
      {expanded && (
        <div className="bg-muted/30 px-10 py-2 text-xs">
          <div className="space-y-1">
            <div className="flex gap-2">
              <span className="text-muted-foreground">ID:</span>
              <span className="font-mono truncate">{request.id}</span>
            </div>
            {request.signedEvent && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">Event ID:</span>
                <span className="font-mono truncate">
                  {request.signedEvent.id}
                </span>
              </div>
            )}
            {request.error && (
              <div className="flex gap-2 text-red-500">
                <span>Error:</span>
                <span>{request.error}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-muted-foreground">Content:</span>
              <span className="truncate max-w-md">
                {request.unsignedEvent.content.slice(0, 100)}
                {request.unsignedEvent.content.length > 100 && "..."}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PublishRequestRow({ request }: { request: PublishRequest }) {
  const [expanded, setExpanded] = useState(false);

  const relayStats = useMemo(() => {
    const results = Object.values(request.relayResults);
    return {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      failed: results.filter((r) => r.status === "failed").length,
      pending: results.filter((r) => r.status === "pending").length,
    };
  }, [request.relayResults]);

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 py-2 px-3 hover:bg-muted/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <StatusIcon status={request.status} />
        <span className="font-mono text-sm">Kind {request.event.kind}</span>
        <span className="text-muted-foreground text-xs">
          {relayStats.success}/{relayStats.total} relays
        </span>
        <span className="text-muted-foreground text-xs">
          {formatDistanceToNow(request.timestamp, { addSuffix: true })}
        </span>
        {request.duration && (
          <span className="text-muted-foreground text-xs ml-auto">
            {request.duration}ms
          </span>
        )}
      </div>
      {expanded && (
        <div className="bg-muted/30 px-10 py-2 text-xs">
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="text-muted-foreground">Event ID:</span>
              <span className="font-mono truncate">{request.eventId}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">Mode:</span>
              <span>{request.relayMode.mode}</span>
            </div>
            <div>
              <span className="text-muted-foreground mb-1 block">
                Relay Results:
              </span>
              <div className="space-y-1 pl-2">
                {Object.entries(request.relayResults).map(([relay, result]) => (
                  <div key={relay} className="flex items-center gap-2">
                    <StatusIcon status={result.status} />
                    <RelayLink
                      url={relay}
                      showInboxOutbox={false}
                      className="text-xs"
                    />
                    {result.error && (
                      <span className="text-red-500 text-xs truncate">
                        {result.error}
                      </span>
                    )}
                    {result.completedAt && result.startedAt && (
                      <span className="text-muted-foreground ml-auto">
                        {result.completedAt - result.startedAt}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PublishHistoryViewer() {
  const { signHistory, publishHistory, stats, clearAllHistory } =
    usePublishing();
  const [tab, setTab] = useState<"publish" | "sign">("publish");

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Publishing Activity</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => clearAllHistory()}
          className="gap-2"
        >
          <RefreshCw className="h-3 w-3" />
          Clear History
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 p-4 border-b bg-muted/30">
        <div className="text-center">
          <div className="text-2xl font-bold">{stats.totalPublishRequests}</div>
          <div className="text-xs text-muted-foreground">Total Publishes</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-500">
            {stats.successfulPublishes}
          </div>
          <div className="text-xs text-muted-foreground">Successful</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-yellow-500">
            {stats.partialPublishes}
          </div>
          <div className="text-xs text-muted-foreground">Partial</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-500">
            {stats.failedPublishes}
          </div>
          <div className="text-xs text-muted-foreground">Failed</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "publish"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("publish")}
        >
          Publish History ({publishHistory.length})
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "sign"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("sign")}
        >
          Sign History ({signHistory.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "publish" ? (
          publishHistory.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No publish history yet. Events you publish will appear here.
            </div>
          ) : (
            <div>
              {publishHistory.map((request) => (
                <PublishRequestRow key={request.id} request={request} />
              ))}
            </div>
          )
        ) : signHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No sign history yet. Events you sign will appear here.
          </div>
        ) : (
          <div>
            {signHistory.map((request) => (
              <SignRequestRow key={request.id} request={request} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
