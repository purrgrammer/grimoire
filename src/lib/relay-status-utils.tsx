import {
  Wifi,
  WifiOff,
  Loader2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Shield,
} from "lucide-react";
import type { RelayState } from "@/types/relay-state";

/**
 * Get connection icon and label for a relay state
 */
export function getConnectionIcon(relay: RelayState | undefined) {
  if (!relay) {
    return {
      icon: <WifiOff className="size-3 text-muted-foreground" />,
      label: "Unknown",
    };
  }

  const iconMap = {
    connected: {
      icon: <Wifi className="size-3 text-success/70" />,
      label: "Connected",
    },
    connecting: {
      icon: <Loader2 className="size-3 text-warning/70 animate-spin" />,
      label: "Connecting",
    },
    disconnected: {
      icon: <WifiOff className="size-3 text-muted-foreground/60" />,
      label: "Disconnected",
    },
    error: {
      icon: <XCircle className="size-3 text-destructive/70" />,
      label: "Connection Error",
    },
  };
  return iconMap[relay.connectionState];
}

/**
 * Get authentication icon and label for a relay state
 * Always returns an icon (including for unauthenticated relays)
 */
export function getAuthIcon(relay: RelayState | undefined) {
  if (!relay) {
    return {
      icon: <Shield className="size-3 text-muted-foreground/40" />,
      label: "Unknown",
    };
  }

  const iconMap = {
    authenticated: {
      icon: <ShieldCheck className="size-3 text-success/70" />,
      label: "Authenticated",
    },
    challenge_received: {
      icon: <ShieldQuestion className="size-3 text-warning/70" />,
      label: "Challenge Received",
    },
    authenticating: {
      icon: <Loader2 className="size-3 text-warning/70 animate-spin" />,
      label: "Authenticating",
    },
    failed: {
      icon: <ShieldX className="size-3 text-destructive/70" />,
      label: "Authentication Failed",
    },
    rejected: {
      icon: <ShieldAlert className="size-3 text-muted-foreground/60" />,
      label: "Authentication Rejected",
    },
    none: {
      icon: <Shield className="size-3 text-muted-foreground/40" />,
      label: "Not required",
    },
  };
  return iconMap[relay.authStatus] || iconMap.none;
}
