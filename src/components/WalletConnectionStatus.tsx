/**
 * WalletConnectionStatus Component
 *
 * Displays a visual indicator for wallet connection status.
 * Shows different colors and animations based on status:
 * - connected: green
 * - connecting: yellow (pulsing)
 * - error: red
 * - disconnected: gray
 */

import type { NWCConnectionStatus } from "@/services/nwc";

interface WalletConnectionStatusProps {
  status: NWCConnectionStatus;
  /** Size of the indicator */
  size?: "sm" | "md";
  /** Whether to show the status label */
  showLabel?: boolean;
  /** Additional class names */
  className?: string;
}

const sizeClasses = {
  sm: "size-1.5",
  md: "size-2",
};

/**
 * Get the color class for a connection status
 */
export function getConnectionStatusColor(status: NWCConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-green-500";
    case "connecting":
      return "bg-yellow-500 animate-pulse";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

export function WalletConnectionStatus({
  status,
  size = "sm",
  showLabel = false,
  className = "",
}: WalletConnectionStatusProps) {
  const colorClass = getConnectionStatusColor(status);

  if (!showLabel) {
    return (
      <span className={`${sizeClasses[size]} ${colorClass} ${className}`} />
    );
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className={`${sizeClasses[size]} ${colorClass}`} />
      <span className="text-sm font-medium capitalize">{status}</span>
    </div>
  );
}
