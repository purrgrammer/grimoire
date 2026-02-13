import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Wifi,
  WifiOff,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Shield,
  XCircle,
  Settings,
  Activity,
  Clock,
  AlertCircle,
  Skull,
} from "lucide-react";
import { useRelayState } from "@/hooks/useRelayState";
import type { RelayState } from "@/types/relay-state";
import { RelayLink } from "./nostr/RelayLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { isAuthPreference } from "@/lib/type-guards";
import liveness from "@/services/relay-liveness";

/**
 * CONN viewer - displays connection and auth status for all relays in the pool
 */
function ConnViewer() {
  const { relays } = useRelayState();

  const relayList = Object.values(relays);

  // Group by connection state
  const connectedRelays = relayList
    .filter((r) => r.connectionState === "connected")
    .sort((a, b) => a.url.localeCompare(b.url));

  const disconnectedRelays = relayList
    .filter((r) => r.connectionState !== "connected")
    .sort((a, b) => a.url.localeCompare(b.url));

  // Get all seen relays for liveness section
  const seenRelays = liveness.getSeenRelays().sort();

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Relay List */}
      <div className="flex-1 overflow-y-auto">
        {relayList.length === 0 && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            No relays in pool
          </div>
        )}

        {/* Connected */}
        {connectedRelays.length > 0 && (
          <>
            <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
              Connected ({connectedRelays.length})
            </div>
            {connectedRelays.map((relay) => (
              <RelayCard key={relay.url} relay={relay} />
            ))}
          </>
        )}

        {/* Disconnected */}
        {disconnectedRelays.length > 0 && (
          <>
            <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
              Disconnected ({disconnectedRelays.length})
            </div>
            {disconnectedRelays.map((relay) => (
              <RelayCard key={relay.url} relay={relay} />
            ))}
          </>
        )}

        {/* Relay Liveness Stats */}
        {seenRelays.length > 0 && (
          <>
            <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
              Relay Liveness
            </div>
            {seenRelays.map((url) => (
              <LivenessStatsRow key={url} url={url} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface RelayCardProps {
  relay: RelayState;
}

function RelayCard({ relay }: RelayCardProps) {
  const { setAuthPreference } = useRelayState();
  const [isSavingPreference, setIsSavingPreference] = useState(false);

  const connectionIcon = () => {
    const iconMap = {
      connected: {
        icon: <Wifi className="size-4 text-green-500" />,
        label: "Connected",
      },
      connecting: {
        icon: <Loader2 className="size-4 text-yellow-500 animate-spin" />,
        label: "Connecting",
      },
      disconnected: {
        icon: <WifiOff className="size-4 text-muted-foreground" />,
        label: "Disconnected",
      },
      error: {
        icon: <XCircle className="size-4 text-red-500" />,
        label: "Connection Error",
      },
    };
    return iconMap[relay.connectionState];
  };

  const authIcon = () => {
    const iconMap = {
      authenticated: {
        icon: <ShieldCheck className="size-4 text-green-500" />,
        label: "Authenticated",
      },
      challenge_received: {
        icon: <ShieldQuestion className="size-4 text-yellow-500" />,
        label: "Challenge Received",
      },
      authenticating: {
        icon: <Loader2 className="size-4 text-yellow-500 animate-spin" />,
        label: "Authenticating",
      },
      failed: {
        icon: <ShieldX className="size-4 text-red-500" />,
        label: "Authentication Failed",
      },
      rejected: {
        icon: <ShieldAlert className="size-4 text-muted-foreground" />,
        label: "Authentication Rejected",
      },
      none: {
        icon: <Shield className="size-4 text-muted-foreground" />,
        label: "No Authentication",
      },
    };
    return iconMap[relay.authStatus] || iconMap.none;
  };

  const connIcon = connectionIcon();
  const auth = authIcon();

  const currentPreference = relay.authPreference || "ask";

  return (
    <div className="border-b border-border">
      <div className="px-4 py-2 flex flex-col gap-2">
        {/* Main Row */}
        <div className="flex items-center gap-3 justify-between">
          <RelayLink
            url={relay.url}
            showInboxOutbox={false}
            className="line-clamp-1 hover:bg-transparent hover:underline hover:decoration-dotted"
            iconClassname="size-4"
            urlClassname="text-sm"
          />
          <div className="flex items-center gap-2">
            {relay.authStatus !== "none" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">{auth.icon}</div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{auth.label}</p>
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

            {/* Auth Settings Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={isSavingPreference}
                  className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingPreference ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Settings className="size-4" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <RelayLink
                    url={relay.url}
                    className="pointer-events-none"
                    iconClassname="size-4"
                    urlClassname="text-sm"
                  />
                </DropdownMenuLabel>
                <DropdownMenuLabel>
                  <div className="flex flex-row items-center gap-2">
                    <div className="cursor-help size-4">{connIcon.icon}</div>
                    <span className="text-sm">{connIcon.label}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  <div className="flex flex-row gap-2 items-center">
                    <ShieldQuestion className="size-4 text-muted-foreground" />
                    <span>Auth</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={currentPreference}
                  onValueChange={async (value) => {
                    if (!isAuthPreference(value)) {
                      console.error("Invalid auth preference:", value);
                      return;
                    }

                    setIsSavingPreference(true);
                    setAuthPreference(relay.url, value);
                    toast.success("Preference saved");
                    setIsSavingPreference(false);
                  }}
                >
                  <DropdownMenuRadioItem value="ask">Ask</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="always">
                    Always
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="never">
                    Never
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LivenessStatsRowProps {
  url: string;
}

function LivenessStatsRow({ url }: LivenessStatsRowProps) {
  const [livenessState, setLivenessState] = useState(liveness.getState(url));

  // Subscribe to liveness state updates
  useEffect(() => {
    const subscription = liveness.state(url).subscribe((state) => {
      setLivenessState(state);
    });

    return () => subscription.unsubscribe();
  }, [url]);

  // Format liveness state icon and label
  const livenessIcon = () => {
    if (!livenessState) {
      return {
        icon: <Activity className="size-4 text-muted-foreground" />,
        label: "Unknown",
      };
    }

    const iconMap = {
      online: {
        icon: <Activity className="size-4 text-green-500" />,
        label: "Online",
      },
      offline: {
        icon: <WifiOff className="size-4 text-yellow-500" />,
        label: "Offline",
      },
      dead: { icon: <Skull className="size-4 text-red-500" />, label: "Dead" },
    };
    return iconMap[livenessState.state];
  };

  // Format backoff remaining time
  const formatBackoffTime = (ms: number) => {
    if (ms <= 0) return null;
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}m`;
  };

  const backoffRemaining = livenessState
    ? liveness.getBackoffRemaining(url)
    : 0;
  const isInBackoff = backoffRemaining > 0;

  if (!livenessState) {
    return null;
  }

  return (
    <div className="border-b border-border px-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <RelayLink
          url={url}
          showInboxOutbox={false}
          className="line-clamp-1 hover:bg-transparent hover:underline hover:decoration-dotted"
          iconClassname="size-4"
          urlClassname="text-sm"
        />
        <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono flex-shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-help">{livenessIcon().icon}</div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{livenessIcon().label}</p>
            </TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-1.5">
            <AlertCircle className="size-4" />
            <span>{livenessState.failureCount}</span>
          </div>
          {isInBackoff && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help flex items-center gap-1.5 text-yellow-500">
                  <Clock className="size-4" />
                  <span>{formatBackoffTime(backoffRemaining)}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Backoff</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConnViewer;
