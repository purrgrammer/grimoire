/**
 * useEventPublisher - Event publishing hook
 *
 * Handles event signing and publishing with per-relay status tracking.
 * Works with useRelaySelection for relay management.
 */

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { NostrEvent } from "nostr-tools";
import { useAccount } from "@/hooks/useAccount";
import pool from "@/services/relay-pool";
import eventStore from "@/services/event-store";
import type { RelayStatus } from "@/hooks/useRelaySelection";

export interface PublishResult {
  success: boolean;
  successCount: number;
  totalCount: number;
  event: NostrEvent | null;
}

export interface UseEventPublisherResult {
  /** Whether currently publishing */
  isPublishing: boolean;
  /** Last published event (for retries and preview) */
  lastPublishedEvent: NostrEvent | null;
  /** Publish a signed event to relays */
  publishEvent: (
    event: NostrEvent,
    relayUrls: string[],
    onRelayStatus: (url: string, status: RelayStatus, error?: string) => void,
  ) => Promise<PublishResult>;
  /** Retry publishing to a specific relay */
  retryRelay: (
    relayUrl: string,
    onRelayStatus: (url: string, status: RelayStatus, error?: string) => void,
  ) => Promise<boolean>;
  /** Clear the last published event */
  clearLastEvent: () => void;
}

export function useEventPublisher(): UseEventPublisherResult {
  const { canSign } = useAccount();
  const [isPublishing, setIsPublishing] = useState(false);
  const [lastPublishedEvent, setLastPublishedEvent] =
    useState<NostrEvent | null>(null);

  // Use ref to track the event for retry without stale closure
  const lastEventRef = useRef<NostrEvent | null>(null);

  // Publish a signed event to relays
  const publishEvent = useCallback(
    async (
      event: NostrEvent,
      relayUrls: string[],
      onRelayStatus: (url: string, status: RelayStatus, error?: string) => void,
    ): Promise<PublishResult> => {
      if (!canSign) {
        toast.error("Please log in to publish");
        return { success: false, successCount: 0, totalCount: 0, event: null };
      }

      if (relayUrls.length === 0) {
        toast.error("Please select at least one relay");
        return { success: false, successCount: 0, totalCount: 0, event: null };
      }

      setIsPublishing(true);

      // Store the signed event for potential retries
      setLastPublishedEvent(event);
      lastEventRef.current = event;

      // Update relay states - set all to publishing
      for (const url of relayUrls) {
        onRelayStatus(url, "publishing");
      }

      try {
        // Publish to each relay individually to track status
        const publishPromises = relayUrls.map(async (relayUrl) => {
          try {
            await pool.publish([relayUrl], event);
            onRelayStatus(relayUrl, "success");
            return { success: true, relayUrl };
          } catch (error) {
            console.error(`Failed to publish to ${relayUrl}:`, error);
            onRelayStatus(
              relayUrl,
              "error",
              error instanceof Error ? error.message : "Unknown error",
            );
            return { success: false, relayUrl };
          }
        });

        // Wait for all publishes to complete
        const results = await Promise.allSettled(publishPromises);

        // Count successes
        const successCount = results.filter(
          (r) => r.status === "fulfilled" && r.value.success,
        ).length;

        if (successCount > 0) {
          // At least one relay succeeded - add to event store
          eventStore.add(event);

          // Show success toast
          if (successCount === relayUrls.length) {
            toast.success(
              `Published to all ${relayUrls.length} relay${relayUrls.length > 1 ? "s" : ""}`,
            );
          } else {
            toast.warning(
              `Published to ${successCount} of ${relayUrls.length} relays`,
            );
          }
        } else {
          // All relays failed
          toast.error(
            "Failed to publish to any relay. Please check your relay connections and try again.",
          );
        }

        return {
          success: successCount > 0,
          successCount,
          totalCount: relayUrls.length,
          event,
        };
      } finally {
        setIsPublishing(false);
      }
    },
    [canSign],
  );

  // Retry publishing to a specific relay
  const retryRelay = useCallback(
    async (
      relayUrl: string,
      onRelayStatus: (url: string, status: RelayStatus, error?: string) => void,
    ): Promise<boolean> => {
      const event = lastEventRef.current;
      if (!event) {
        toast.error("No event to retry");
        return false;
      }

      try {
        onRelayStatus(relayUrl, "publishing");
        await pool.publish([relayUrl], event);
        onRelayStatus(relayUrl, "success");
        toast.success(`Published to ${relayUrl.replace(/^wss?:\/\//, "")}`);
        return true;
      } catch (error) {
        console.error(`Failed to retry publish to ${relayUrl}:`, error);
        onRelayStatus(
          relayUrl,
          "error",
          error instanceof Error ? error.message : "Unknown error",
        );
        toast.error(
          `Failed to publish to ${relayUrl.replace(/^wss?:\/\//, "")}`,
        );
        return false;
      }
    },
    [],
  );

  // Clear the last published event
  const clearLastEvent = useCallback(() => {
    setLastPublishedEvent(null);
    lastEventRef.current = null;
  }, []);

  return {
    isPublishing,
    lastPublishedEvent,
    publishEvent,
    retryRelay,
    clearLastEvent,
  };
}
