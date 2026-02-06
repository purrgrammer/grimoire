/**
 * TransactionRow Component
 *
 * Displays a single transaction in a list.
 * Shared between NWC and NIP-61 wallet viewers.
 */

import { ReactNode } from "react";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface TransactionRowProps {
  /** Transaction direction */
  direction: "in" | "out";
  /** Amount in satoshis */
  amount: number;
  /** Whether amount should be blurred */
  blurred?: boolean;
  /** Transaction label/description */
  label: ReactNode;
  /** Click handler */
  onClick?: () => void;
}

/**
 * Format satoshi amount with locale-aware thousands separator
 */
function formatSats(sats: number): string {
  return sats.toLocaleString();
}

export function TransactionRow({
  direction,
  amount,
  blurred = false,
  label,
  onClick,
}: TransactionRowProps) {
  return (
    <div
      className="flex items-center justify-between border-b border-border px-4 py-2.5 hover:bg-muted/50 transition-colors flex-shrink-0 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {direction === "in" ? (
          <ArrowDownLeft className="size-4 text-green-500 flex-shrink-0" />
        ) : (
          <ArrowUpRight className="size-4 text-red-500 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">{label}</div>
      </div>
      <div className="flex-shrink-0 ml-4">
        <p className="text-sm font-semibold font-mono">
          {blurred ? "✦✦✦✦" : formatSats(amount)}
        </p>
      </div>
    </div>
  );
}
