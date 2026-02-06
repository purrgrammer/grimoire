/**
 * WalletBalance Component
 *
 * Displays a large centered balance with privacy blur toggle.
 * Shared between NWC and NIP-61 wallet viewers.
 */

import { Eye, EyeOff } from "lucide-react";

interface WalletBalanceProps {
  /** Balance in satoshis */
  balance: number | undefined;
  /** Whether balance is blurred for privacy */
  blurred: boolean;
  /** Callback to toggle blur */
  onToggleBlur: () => void;
  /** Optional label shown below balance */
  label?: string;
}

/**
 * Format satoshi amount with locale-aware thousands separator
 */
function formatSats(sats: number | undefined): string {
  if (sats === undefined) return "—";
  return sats.toLocaleString();
}

export function WalletBalance({
  balance,
  blurred,
  onToggleBlur,
  label,
}: WalletBalanceProps) {
  return (
    <div className="py-4 flex flex-col items-center justify-center">
      <button
        onClick={onToggleBlur}
        className="text-4xl font-bold font-mono hover:opacity-70 transition-opacity cursor-pointer flex items-center gap-3"
        title="Click to toggle privacy blur"
      >
        <span>{blurred ? "✦✦✦✦✦✦" : formatSats(balance)}</span>
        {blurred ? (
          <EyeOff className="size-5 text-muted-foreground" />
        ) : (
          <Eye className="size-5 text-muted-foreground" />
        )}
      </button>
      {label && (
        <span className="text-sm text-muted-foreground mt-1">{label}</span>
      )}
    </div>
  );
}
