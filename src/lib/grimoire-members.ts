/**
 * Grimoire Member System
 *
 * Defines special usernames for Grimoire project members with custom NIP-05 style identifiers.
 * Members get special gradient styling to distinguish them visually.
 */

/**
 * Grimoire member definition
 */
export interface GrimoireMember {
  /** Username for display (e.g., "_", "verbiricha") */
  username: string;
  /** Hex pubkey */
  pubkey: string;
  /** NIP-05 style identifier (e.g., "_@grimoire.rocks") */
  nip05: string;
}

/**
 * Official Grimoire project members
 * These users get special gradient styling applied to their usernames
 */
export const GRIMOIRE_MEMBERS: readonly GrimoireMember[] = [
  {
    username: "_",
    pubkey: "c8fb0d3aa788b9ace4f6cb92dd97d3f292db25b5c9f92462ef6c64926129fbaf",
    nip05: "_@grimoire.rocks",
  },
  {
    username: "verbiricha",
    pubkey: "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194",
    nip05: "verbiricha@grimoire.rocks",
  },
] as const;

/**
 * Map of pubkey -> member for O(1) lookups
 */
const membersByPubkey = new Map<string, GrimoireMember>(
  GRIMOIRE_MEMBERS.map((member) => [member.pubkey, member]),
);

/**
 * Map of NIP-05 identifier -> member for O(1) lookups
 */
const membersByNip05 = new Map<string, GrimoireMember>(
  GRIMOIRE_MEMBERS.map((member) => [member.nip05, member]),
);

/**
 * Check if a pubkey belongs to a Grimoire member
 * @param pubkey - Hex public key
 * @returns true if user is a Grimoire member
 */
export function isGrimoireMember(pubkey: string): boolean {
  return membersByPubkey.has(pubkey.toLowerCase());
}

/**
 * Get Grimoire member info by pubkey
 * @param pubkey - Hex public key
 * @returns Member info or undefined
 */
export function getGrimoireMember(pubkey: string): GrimoireMember | undefined {
  return membersByPubkey.get(pubkey.toLowerCase());
}

/**
 * Get Grimoire member info by NIP-05 identifier
 * @param nip05 - NIP-05 identifier (e.g., "_@grimoire.rocks")
 * @returns Member info or undefined
 */
export function getGrimoireMemberByNip05(
  nip05: string,
): GrimoireMember | undefined {
  return membersByNip05.get(nip05.toLowerCase());
}

/**
 * Get Grimoire username for a pubkey
 * @param pubkey - Hex public key
 * @returns Username or undefined if not a member
 */
export function getGrimoireUsername(pubkey: string): string | undefined {
  return membersByPubkey.get(pubkey.toLowerCase())?.username;
}

/**
 * Get Grimoire NIP-05 identifier for a pubkey
 * @param pubkey - Hex public key
 * @returns NIP-05 identifier or undefined if not a member
 */
export function getGrimoireNip05(pubkey: string): string | undefined {
  return membersByPubkey.get(pubkey.toLowerCase())?.nip05;
}

/**
 * Official Grimoire project pubkey for donations
 * Corresponds to user "_" in GRIMOIRE_MEMBERS
 */
export const GRIMOIRE_DONATE_PUBKEY =
  "c8fb0d3aa788b9ace4f6cb92dd97d3f292db25b5c9f92462ef6c64926129fbaf";

/**
 * Official Grimoire project Lightning address for donations
 */
export const GRIMOIRE_LIGHTNING_ADDRESS = "grimoire@coinos.io";
