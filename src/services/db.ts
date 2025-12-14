import { ProfileContent } from "applesauce-core/helpers";
import { Dexie, Table } from "dexie";
import { RelayInformation } from "../types/nip11";
import { normalizeRelayURL } from "../lib/relay-url";

export interface Profile extends ProfileContent {
  pubkey: string;
  created_at: number;
}

export interface Nip05 {
  nip05: string;
  pubkey: string;
}

export interface Nip {
  id: string;
  content: string;
  fetchedAt: number;
}

export interface RelayInfo {
  url: string;
  info: RelayInformation;
  fetchedAt: number;
}

export interface RelayAuthPreference {
  url: string;
  preference: "always" | "never" | "ask";
  updatedAt: number;
}

class GrimoireDb extends Dexie {
  profiles!: Table<Profile>;
  nip05!: Table<Nip05>;
  nips!: Table<Nip>;
  relayInfo!: Table<RelayInfo>;
  relayAuthPreferences!: Table<RelayAuthPreference>;

  constructor(name: string) {
    super(name);

    // Version 5: Current schema
    this.version(5).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
      relayAuthPreferences: "&url",
    });

    // Version 6: Normalize relay URLs
    this.version(6)
      .stores({
        profiles: "&pubkey",
        nip05: "&nip05",
        nips: "&id",
        relayInfo: "&url",
        relayAuthPreferences: "&url",
      })
      .upgrade(async (tx) => {
        console.log("[DB Migration v6] Normalizing relay URLs...");

        // Migrate relayAuthPreferences
        const authPrefs = await tx
          .table<RelayAuthPreference>("relayAuthPreferences")
          .toArray();
        const normalizedAuthPrefs = new Map<string, RelayAuthPreference>();
        let skippedAuthPrefs = 0;

        for (const pref of authPrefs) {
          try {
            const normalizedUrl = normalizeRelayURL(pref.url);
            const existing = normalizedAuthPrefs.get(normalizedUrl);

            // Keep the most recent preference if duplicates exist
            if (!existing || pref.updatedAt > existing.updatedAt) {
              normalizedAuthPrefs.set(normalizedUrl, {
                ...pref,
                url: normalizedUrl,
              });
            }
          } catch (error) {
            skippedAuthPrefs++;
            console.warn(
              `[DB Migration v6] Skipping invalid relay URL in auth preferences: ${pref.url}`,
              error,
            );
          }
        }

        await tx.table("relayAuthPreferences").clear();
        await tx
          .table("relayAuthPreferences")
          .bulkAdd(Array.from(normalizedAuthPrefs.values()));
        console.log(
          `[DB Migration v6] Normalized ${normalizedAuthPrefs.size} auth preferences` +
            (skippedAuthPrefs > 0
              ? ` (skipped ${skippedAuthPrefs} invalid)`
              : ""),
        );

        // Migrate relayInfo
        const relayInfos = await tx.table<RelayInfo>("relayInfo").toArray();
        const normalizedRelayInfos = new Map<string, RelayInfo>();
        let skippedRelayInfos = 0;

        for (const info of relayInfos) {
          try {
            const normalizedUrl = normalizeRelayURL(info.url);
            const existing = normalizedRelayInfos.get(normalizedUrl);

            // Keep the most recent info if duplicates exist
            if (!existing || info.fetchedAt > existing.fetchedAt) {
              normalizedRelayInfos.set(normalizedUrl, {
                ...info,
                url: normalizedUrl,
              });
            }
          } catch (error) {
            skippedRelayInfos++;
            console.warn(
              `[DB Migration v6] Skipping invalid relay URL in relay info: ${info.url}`,
              error,
            );
          }
        }

        await tx.table("relayInfo").clear();
        await tx
          .table("relayInfo")
          .bulkAdd(Array.from(normalizedRelayInfos.values()));
        console.log(
          `[DB Migration v6] Normalized ${normalizedRelayInfos.size} relay infos` +
            (skippedRelayInfos > 0
              ? ` (skipped ${skippedRelayInfos} invalid)`
              : ""),
        );
        console.log("[DB Migration v6] Complete!");
      });
  }
}

const db = new GrimoireDb("grimoire-dev");

export default db;
