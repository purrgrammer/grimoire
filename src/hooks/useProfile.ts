import { useState, useEffect } from "react";
import { profileLoader } from "@/services/loaders";
import { ProfileContent } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import db from "@/services/db";

export function useProfile(pubkey: string): ProfileContent | undefined {
  const [profile, setProfile] = useState<ProfileContent | undefined>();

  useEffect(() => {
    let mounted = true;

    // Load from IndexedDB first
    db.profiles.get(pubkey).then((cachedProfile) => {
      if (mounted && cachedProfile) {
        setProfile(cachedProfile);
      }
    });

    // Fetch from network
    const sub = profileLoader({ kind: kinds.Metadata, pubkey }).subscribe({
      next: async (fetchedEvent) => {
        if (!fetchedEvent || !fetchedEvent.content) return;

        try {
          const profileData = JSON.parse(fetchedEvent.content) as ProfileContent;
          
          // Save to IndexedDB
          await db.profiles.put({
            ...profileData,
            pubkey,
            created_at: fetchedEvent.created_at,
          });

          if (mounted) {
            setProfile(profileData);
          }
        } catch (e) {
          console.error("[useProfile] Failed to parse profile:", e);
        }
      },
      error: (err) => {
        console.error("[useProfile] Error fetching profile:", err);
      },
    });

    return () => {
      mounted = false;
      sub.unsubscribe();
    };
  }, [pubkey]);

  return profile;
}
