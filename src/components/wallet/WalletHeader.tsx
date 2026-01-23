/**
 * WalletHeader Component
 *
 * Displays wallet name, status indicator, and action buttons.
 * Shared between NWC and NIP-61 wallet viewers.
 */

import { ReactNode } from "react";

export type WalletStatus = "connected" | "locked" | "disconnected" | "loading";

interface WalletHeaderProps {
  /** Wallet name/alias */
  name: string;
  /** Connection/unlock status */
  status: WalletStatus;
  /** Action buttons (refresh, settings, disconnect, etc.) */
  actions?: ReactNode;
  /** Additional info content (dropdown, badges, etc.) */
  info?: ReactNode;
}

function StatusIndicator({ status }: { status: WalletStatus }) {
  const colors: Record<WalletStatus, string> = {
    connected: "bg-green-500",
    locked: "bg-yellow-500",
    disconnected: "bg-red-500",
    loading: "bg-blue-500 animate-pulse",
  };

  return <div className={`size-1.5 rounded-full ${colors[status]}`} />;
}

export function WalletHeader({
  name,
  status,
  actions,
  info,
}: WalletHeaderProps) {
  return (
    <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between">
      {/* Left: Wallet Name + Status */}
      <div className="flex items-center gap-2">
        <span className="font-semibold">{name}</span>
        <StatusIndicator status={status} />
        {info}
      </div>

      {/* Right: Actions */}
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
