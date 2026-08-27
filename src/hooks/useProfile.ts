import { useState, useEffect, useRef, useMemo } from "react";
import { profileLoader } from "@/services/loaders";
import { ProfileContent, getProfileContent } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import db from "@/services/db";
import { getEmojiTags, type EmojiTag } from "@/lib/emoji-helpers";

/** Profile metadata plus the kind 0 emoji tags its name may reference */
export type ProfileWithEmojis = ProfileContent & { emojis?: EmojiTag[] };

/**
 * A profile whose `emojis` is the event's NIP-30 TAGS and nothing else.
 *
 * `getProfileContent` hands back the kind 0's JSON verbatim — every field the
 * author chose to publish, at whatever type they published it. This type says
 * `emojis?: EmojiTag[]`, which is an assertion over untrusted input, not a
 * fact: a profile carrying `"emojis": "🔥"` in its content satisfies every
 * length check downstream and then fails on `.map`, which is what took out
 * every feed row that rendered that person's name.
 *
 * So the content's own field is dropped — destructured out rather than
 * deleted, because `getProfileContent` memoizes its result on the event and
 * mutating it would poison every later read — and replaced by the tags.
 */
export function withEmojiTags(
  profile: ProfileContent,
  emojis: EmojiTag[],
): ProfileWithEmojis {
  const { emojis: _fromContent, ...rest } = profile as ProfileWithEmojis;
  return emojis.length > 0 ? { ...rest, emojis } : rest;
}

/**
 * The same guarantee for a row read back out of Dexie, which was written before
 * this was enforced and can still hold whatever the content carried.
 */
export function sanitizeCachedProfile(
  profile: ProfileWithEmojis,
): ProfileWithEmojis {
  return Array.isArray(profile.emojis)
    ? profile
    : withEmojiTags(profile as ProfileContent, []);
}

/**
 * Hook to fetch and cache user profile metadata
 *
 * Uses AbortController to prevent race conditions when:
 * - Component unmounts during async operations
 * - Pubkey changes while a fetch is in progress
 *
 * @param pubkey - The user's public key (hex)
 * @param relayHints - Optional relay URLs to try fetching from
 * @returns profile metadata (with NIP-30 emoji tags) or undefined if loading/not found
 */
export function useProfile(
  pubkey?: string,
  relayHints?: string[],
): ProfileWithEmojis | undefined {
  const [profile, setProfile] = useState<ProfileWithEmojis | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stabilize relayHints so callers can pass [p.relay] without causing
  // the effect to re-run (and abort in-flight fetches) every render.
  const stableRelayHints = useMemo(
    () => relayHints,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(relayHints)],
  );

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
        setProfile(sanitizeCachedProfile(cachedProfile));
      }
    });

    // Fetch from network with optional relay hints
    const sub = profileLoader({
      kind: kinds.Metadata,
      pubkey,
      ...(stableRelayHints &&
        stableRelayHints.length > 0 && { relays: stableRelayHints }),
    }).subscribe({
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

        const withEmojis = withEmojiTags(
          profileData,
          getEmojiTags(fetchedEvent),
        );

        setProfile(withEmojis);

        // Save to IndexedDB after state update to avoid blocking UI
        try {
          await db.profiles.put({
            ...withEmojis,
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
  }, [pubkey, stableRelayHints]);

  return profile;
}
