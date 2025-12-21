import { useState, useEffect, useRef } from "react";
import { profileLoader } from "@/services/loaders";
import { ProfileContent, getProfileContent } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import db from "@/services/db";

/**
 * Hook to fetch and cache user profile metadata
 *
 * Uses AbortController to prevent race conditions when:
 * - Component unmounts during async operations
 * - Pubkey changes while a fetch is in progress
 *
 * @param pubkey - The user's public key (hex)
 * @returns ProfileContent or undefined if loading/not found
 */
export function useProfile(pubkey?: string): ProfileContent | undefined {
  const [profile, setProfile] = useState<ProfileContent | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!pubkey) {
      setProfile(undefined);
      return;
    }

    // Abort any in-flight requests from previous effect runs
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Load from IndexedDB first (fast path)
    db.profiles.get(pubkey).then((cachedProfile) => {
      if (controller.signal.aborted) return;
      if (cachedProfile) {
        setProfile(cachedProfile);
      }
    });

    // Fetch from network
    const sub = profileLoader({ kind: kinds.Metadata, pubkey }).subscribe({
      next: async (fetchedEvent) => {
        if (controller.signal.aborted) return;
        if (!fetchedEvent || !fetchedEvent.content) return;

        // Use applesauce helper for safe profile parsing
        const profileData = getProfileContent(fetchedEvent);
        if (!profileData) {
          console.error("[useProfile] Failed to parse profile for:", pubkey);
          return;
        }

        // Only update state and cache if not aborted
        if (controller.signal.aborted) return;

        setProfile(profileData);

        // Save to IndexedDB after state update to avoid blocking UI
        try {
          await db.profiles.put({
            ...profileData,
            pubkey,
            created_at: fetchedEvent.created_at,
          });
        } catch (err) {
          // Log but don't throw - cache failure shouldn't break the UI
          console.error("[useProfile] Failed to cache profile:", err);
        }
      },
      error: (err) => {
        if (controller.signal.aborted) return;
        console.error("[useProfile] Error fetching profile:", err);
      },
    });

    return () => {
      controller.abort();
      sub.unsubscribe();
    };
  }, [pubkey]);

  return profile;
}
