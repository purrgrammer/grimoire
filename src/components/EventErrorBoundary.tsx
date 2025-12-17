import React, { Component, ReactNode } from "react";
import { AlertTriangle, Bug, FileJson, RefreshCw } from "lucide-react";
import type { NostrEvent } from "@/types/nostr";
import { nip19 } from "nostr-tools";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

interface EventErrorBoundaryProps {
  children: ReactNode;
  event: NostrEvent;
}

interface EventErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

/**
 * Error boundary for event renderers
 * Catches rendering errors and displays diagnostic information
 * Prevents one broken event from crashing the entire feed
 */
export class EventErrorBoundary extends Component<
  EventErrorBoundaryProps,
  EventErrorBoundaryState
> {
  constructor(props: EventErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(_error: Error): Partial<EventErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console for debugging
    console.error("[EventErrorBoundary] Caught rendering error:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });
  }

  componentDidUpdate(prevProps: EventErrorBoundaryProps) {
    // Reset error boundary if event changes
    if (prevProps.event.id !== this.props.event.id) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        showDetails: false,
      });
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  render() {
    if (this.state.hasError) {
      const { event } = this.props;
      const { error, errorInfo, showDetails } = this.state;

      // Generate event ID for debugging
      const eventId = nip19.noteEncode(event.id);

      return (
        <div className="border border-destructive bg-destructive/10 p-4 my-2">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-destructive mb-1">
                Rendering Error
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                This event failed to render. The error has been logged to the console.
              </p>

              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 border border-border">
                  <Bug className="size-3" />
                  <span className="font-mono">Kind {event.kind}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-background/50 px-2 py-1 border border-border">
                  <FileJson className="size-3" />
                  <span className="font-mono truncate max-w-[200px]" title={eventId}>
                    {eventId.slice(0, 16)}...
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={this.handleRetry}
                  className="h-7 text-xs"
                >
                  <RefreshCw className="size-3 mr-1" />
                  Retry
                </Button>

                <Collapsible
                  open={showDetails}
                  onOpenChange={(open) => this.setState({ showDetails: open })}
                >
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      {showDetails ? "Hide" : "Show"} Details
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <div className="bg-background border border-border p-3 text-xs space-y-2">
                      {error && (
                        <div>
                          <div className="font-semibold text-destructive mb-1">
                            Error:
                          </div>
                          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words">
                            {error.toString()}
                          </pre>
                        </div>
                      )}
                      {errorInfo && errorInfo.componentStack && (
                        <div>
                          <div className="font-semibold text-destructive mb-1">
                            Component Stack:
                          </div>
                          <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                            {errorInfo.componentStack}
                          </pre>
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-destructive mb-1">
                          Event JSON:
                        </div>
                        <pre className="text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                          {JSON.stringify(event, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
