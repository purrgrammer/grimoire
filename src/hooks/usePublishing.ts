/**
 * Publishing Hooks
 *
 * React hooks for the unified publishing service.
 * Provides access to sign/publish operations and history.
 */

import { useMemo, useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { publishingService } from "@/services/publishing";
import type {
  RelayMode,
  SignRequest,
  PublishRequest,
  PublishOperation,
  PublishOptions,
  PublishStats,
} from "@/types/publishing";
import type { NostrEvent } from "nostr-tools/core";
import type { UnsignedEvent } from "nostr-tools/pure";

/**
 * Hook to access publishing service state and operations
 *
 * @returns Publishing state and methods
 *
 * @example
 * const { signAndPublish, publishHistory, stats } = usePublishing();
 *
 * // Publish to outbox relays
 * await signAndPublish(unsignedEvent, { mode: 'outbox' });
 *
 * // Publish to explicit relays
 * await signAndPublish(unsignedEvent, { mode: 'explicit', relays: [...] });
 */
export function usePublishing() {
  // Subscribe to reactive state
  const signHistory = use$(publishingService.signHistory$);
  const publishHistory = use$(publishingService.publishHistory$);
  const activePublishes = use$(publishingService.activePublishes$);

  // Memoized operations
  const sign = useCallback(
    (unsignedEvent: UnsignedEvent): Promise<SignRequest> => {
      return publishingService.sign(unsignedEvent);
    },
    [],
  );

  const publish = useCallback(
    (
      event: NostrEvent,
      mode: RelayMode,
      options?: PublishOptions,
    ): Promise<PublishRequest> => {
      return publishingService.publish(event, mode, options);
    },
    [],
  );

  const signAndPublish = useCallback(
    (
      unsignedEvent: UnsignedEvent,
      mode: RelayMode,
      options?: PublishOptions,
    ): Promise<PublishOperation> => {
      return publishingService.signAndPublish(unsignedEvent, mode, options);
    },
    [],
  );

  const republish = useCallback(
    (
      publishRequestId: string,
      options?: PublishOptions,
    ): Promise<PublishRequest> => {
      return publishingService.republish(publishRequestId, options);
    },
    [],
  );

  const republishToRelay = useCallback(
    (publishRequestId: string, relay: string): Promise<PublishRequest> => {
      return publishingService.republishToRelay(publishRequestId, relay);
    },
    [],
  );

  // Recompute stats when history changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = useMemo(
    (): PublishStats => publishingService.getStats(),
    [signHistory.length, publishHistory.length],
  );

  return {
    // State
    signHistory,
    publishHistory,
    activePublishes,
    stats,

    // Operations
    sign,
    publish,
    signAndPublish,
    republish,
    republishToRelay,

    // Helpers
    getSignRequest: publishingService.getSignRequest.bind(publishingService),
    getPublishRequest:
      publishingService.getPublishRequest.bind(publishingService),
    getPublishRequestsForEvent:
      publishingService.getPublishRequestsForEvent.bind(publishingService),
    clearHistory: publishingService.clearHistory.bind(publishingService),
    clearAllHistory: publishingService.clearAllHistory.bind(publishingService),
  };
}

/**
 * Hook to get publish status for a specific event
 *
 * @param eventId - The event ID to track
 * @returns Array of publish requests for this event
 *
 * @example
 * const requests = usePublishStatus(event.id);
 * const latestRequest = requests[0];
 * if (latestRequest?.status === 'success') {
 *   // Event was published successfully
 * }
 */
export function usePublishStatus(eventId: string): PublishRequest[] {
  const publishHistory = use$(publishingService.publishHistory$);

  return useMemo(() => {
    return publishHistory.filter((r) => r.eventId === eventId);
  }, [publishHistory, eventId]);
}

/**
 * Hook to get the active (pending) publishes
 *
 * @returns Array of currently pending publish requests
 *
 * @example
 * const activePublishes = useActivePublishes();
 * if (activePublishes.length > 0) {
 *   // Show publishing indicator
 * }
 */
export function useActivePublishes(): PublishRequest[] {
  return use$(publishingService.activePublishes$);
}

/**
 * Hook to get sign history
 *
 * @returns Array of sign requests ordered by most recent first
 */
export function useSignHistory(): SignRequest[] {
  return use$(publishingService.signHistory$);
}

/**
 * Hook to get publish history
 *
 * @returns Array of publish requests ordered by most recent first
 */
export function usePublishHistory(): PublishRequest[] {
  return use$(publishingService.publishHistory$);
}

/**
 * Convenience hook for simple publish operations
 *
 * @returns Simplified publish functions
 *
 * @example
 * const { publishToOutbox, publishToRelays } = usePublish();
 *
 * // Auto-select relays
 * await publishToOutbox(signedEvent);
 *
 * // Explicit relays
 * await publishToRelays(signedEvent, ['wss://relay1.com', 'wss://relay2.com']);
 */
export function usePublish() {
  const publishToOutbox = useCallback(
    (event: NostrEvent, options?: PublishOptions): Promise<PublishRequest> => {
      return publishingService.publish(event, { mode: "outbox" }, options);
    },
    [],
  );

  const publishToRelays = useCallback(
    (
      event: NostrEvent,
      relays: string[],
      options?: PublishOptions,
    ): Promise<PublishRequest> => {
      return publishingService.publish(
        event,
        { mode: "explicit", relays },
        options,
      );
    },
    [],
  );

  const signAndPublishToOutbox = useCallback(
    (
      unsignedEvent: UnsignedEvent,
      options?: PublishOptions,
    ): Promise<PublishOperation> => {
      return publishingService.signAndPublish(
        unsignedEvent,
        { mode: "outbox" },
        options,
      );
    },
    [],
  );

  const signAndPublishToRelays = useCallback(
    (
      unsignedEvent: UnsignedEvent,
      relays: string[],
      options?: PublishOptions,
    ): Promise<PublishOperation> => {
      return publishingService.signAndPublish(
        unsignedEvent,
        { mode: "explicit", relays },
        options,
      );
    },
    [],
  );

  return {
    publishToOutbox,
    publishToRelays,
    signAndPublishToOutbox,
    signAndPublishToRelays,
  };
}
