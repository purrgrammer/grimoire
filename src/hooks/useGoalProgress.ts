import { useMemo, useState, useEffect } from "react";
import type { NostrEvent } from "@/types/nostr";
import { useTimeline } from "@/hooks/useTimeline";
import { useAccount } from "@/hooks/useAccount";
import {
  getGoalAmount,
  getGoalRelays,
  getGoalClosedAt,
  getGoalTitle,
  getGoalSummary,
  isGoalClosed,
  getGoalBeneficiaries,
} from "@/lib/nip75-helpers";
import { getZapAmount, getZapSender } from "applesauce-common/helpers/zap";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { relayListCache } from "@/services/relay-list-cache";

export interface Contributor {
  pubkey: string;
  totalAmount: number;
  zapCount: number;
}

export interface GoalProgressResult {
  // Metadata
  title: string;
  summary: string | undefined;
  targetAmount: number | undefined;
  closedAt: number | undefined;
  closed: boolean;
  beneficiaries: string[];

  // Progress
  targetSats: number;
  raisedSats: number;
  progress: number;
  contributors: Contributor[];

  // Loading state
  loading: boolean;
  zaps: NostrEvent[];
}

/**
 * Hook for fetching and calculating NIP-75 Zap Goal progress
 *
 * Handles:
 * - Parsing goal metadata from event
 * - Selecting relays (goal relays → user inbox relays → aggregators)
 * - Fetching zap receipts
 * - Calculating total raised and contributor breakdown
 */
export function useGoalProgress(event: NostrEvent): GoalProgressResult {
  const { pubkey: userPubkey } = useAccount();

  // Parse goal metadata
  const title = getGoalTitle(event);
  const summary = getGoalSummary(event);
  const targetAmount = getGoalAmount(event);
  const closedAt = getGoalClosedAt(event);
  const closed = isGoalClosed(event);
  const beneficiaries = getGoalBeneficiaries(event);
  const goalRelays = getGoalRelays(event);

  // Get user's inbox relays as fallback
  const [userInboxRelays, setUserInboxRelays] = useState<string[]>([]);

  useEffect(() => {
    if (!userPubkey) {
      setUserInboxRelays([]);
      return;
    }

    relayListCache.getInboxRelays(userPubkey).then((relays) => {
      setUserInboxRelays(relays || []);
    });
  }, [userPubkey]);

  // Determine which relays to use: goal relays → user inbox → aggregators
  const relays = useMemo(() => {
    if (goalRelays.length > 0) {
      return [...goalRelays, ...AGGREGATOR_RELAYS];
    }
    if (userInboxRelays.length > 0) {
      return [...userInboxRelays, ...AGGREGATOR_RELAYS];
    }
    return AGGREGATOR_RELAYS;
  }, [goalRelays, userInboxRelays]);

  // Fetch zaps for this goal
  const zapFilter = useMemo(
    () => ({
      kinds: [9735],
      "#e": [event.id],
    }),
    [event.id],
  );

  const { events: zaps, loading } = useTimeline(
    `goal-zaps-${event.id}`,
    zapFilter,
    relays,
  );

  // Calculate total raised and contributor breakdown
  const { totalRaised, contributors } = useMemo(() => {
    const contributorMap = new Map<string, Contributor>();
    let total = 0;

    for (const zap of zaps) {
      const amount = getZapAmount(zap) || 0;
      const sender = getZapSender(zap);

      total += amount;

      if (sender) {
        const existing = contributorMap.get(sender);
        if (existing) {
          existing.totalAmount += amount;
          existing.zapCount += 1;
        } else {
          contributorMap.set(sender, {
            pubkey: sender,
            totalAmount: amount,
            zapCount: 1,
          });
        }
      }
    }

    // Sort by amount descending
    const sortedContributors = Array.from(contributorMap.values()).sort(
      (a, b) => b.totalAmount - a.totalAmount,
    );

    return { totalRaised: total, contributors: sortedContributors };
  }, [zaps]);

  // Convert to sats for display
  const targetSats = targetAmount ? Math.floor(targetAmount / 1000) : 0;
  const raisedSats = Math.floor(totalRaised / 1000);
  const progress =
    targetSats > 0 ? Math.min((raisedSats / targetSats) * 100, 100) : 0;

  return {
    // Metadata
    title,
    summary,
    targetAmount,
    closedAt,
    closed,
    beneficiaries,

    // Progress
    targetSats,
    raisedSats,
    progress,
    contributors,

    // Loading state
    loading,
    zaps,
  };
}
