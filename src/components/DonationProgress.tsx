import { useMemo } from "react";
import { useTimeline } from "@/hooks/useTimeline";
import { getZapAmount, getZapSender } from "applesauce-common/helpers/zap";
import { UserName } from "./nostr/UserName";
import { Zap } from "lucide-react";
import { AGGREGATOR_RELAYS } from "@/services/loaders";

const GRIMOIRE_PUBKEY =
  "c8fb0d3aa788b9ace4f6cb92dd97d3f292db25b5c9f92462ef6c64926129fbaf";
const MONTHLY_GOAL = 210_000; // 210k sats

/**
 * DonationProgress - Displays monthly donation progress
 * Shows progress bar, total raised, and top donors
 */
export function DonationProgress() {
  // Get start of current month timestamp
  const monthStart = useMemo(() => {
    const now = new Date();
    return Math.floor(
      new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000,
    );
  }, []);

  // Query zaps to Grimoire from this month
  const { events: zaps, loading } = useTimeline(
    "grimoire-donations",
    {
      kinds: [9735],
      "#p": [GRIMOIRE_PUBKEY],
      since: monthStart,
      limit: 500,
    },
    AGGREGATOR_RELAYS,
    { limit: 500 },
  );

  // Aggregate donations by sender
  const { totalRaised, topDonors } = useMemo(() => {
    const byDonor = new Map<string, number>();

    for (const zap of zaps) {
      const sender = getZapSender(zap);
      const amount = getZapAmount(zap);

      if (sender && amount) {
        const currentTotal = byDonor.get(sender) || 0;
        byDonor.set(sender, currentTotal + amount);
      }
    }

    // Convert msats to sats and calculate total
    const totalMsats = Array.from(byDonor.values()).reduce(
      (sum, amt) => sum + amt,
      0,
    );
    const totalSats = Math.floor(totalMsats / 1000);

    // Get top 3 donors
    const sortedDonors = Array.from(byDonor.entries())
      .map(([pubkey, msats]) => ({
        pubkey,
        sats: Math.floor(msats / 1000),
      }))
      .sort((a, b) => b.sats - a.sats)
      .slice(0, 3);

    return {
      totalRaised: totalSats,
      topDonors: sortedDonors,
    };
  }, [zaps]);

  // Calculate progress percentage
  const progress = Math.min(100, (totalRaised / MONTHLY_GOAL) * 100);

  if (loading && zaps.length === 0) {
    return null; // Don't show until data loads
  }

  return (
    <div className="w-full max-w-md mx-auto mb-8 border border-border rounded-lg p-4 bg-card/50">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="size-4 fill-zap text-zap" />
          <span className="text-sm font-mono text-foreground">
            Support Grimoire
          </span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">
          This Month
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="text-zap font-medium">
            {totalRaised.toLocaleString()} sats
          </span>
          <span className="text-muted-foreground">
            {MONTHLY_GOAL.toLocaleString()} goal
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-zap to-yellow-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-1 text-center">
          {progress.toFixed(1)}% funded
        </div>
      </div>

      {/* Top Donors */}
      {topDonors.length > 0 && (
        <div className="border-t border-border pt-3">
          <div className="text-xs text-muted-foreground font-mono mb-2">
            Top Supporters
          </div>
          <div className="flex flex-col gap-1">
            {topDonors.map((donor, idx) => (
              <div
                key={donor.pubkey}
                className="flex items-center justify-between text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-mono text-xs w-4">
                    {idx + 1}.
                  </span>
                  <UserName
                    pubkey={donor.pubkey}
                    className="text-foreground truncate max-w-[120px]"
                  />
                </div>
                <span className="text-zap font-mono text-xs font-medium">
                  {donor.sats.toLocaleString()}⚡
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
