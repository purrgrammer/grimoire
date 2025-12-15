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

/**
 * Get authentication icon and label for a relay state
 * Returns null if no authentication is required
 */
export function getAuthIcon(relay: RelayState | undefined) {
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
