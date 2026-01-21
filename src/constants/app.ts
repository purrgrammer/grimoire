/**
 * Grimoire app constants
 */

/**
 * Grimoire NIP-89 app definition address (kind 31990)
 * Format: "kind:pubkey:identifier"
 */
export const GRIMOIRE_APP_ADDRESS =
  "31990:7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194:k50nvf8d85";

/**
 * Client tag for events published by Grimoire
 * Format: ["client", "<name>", "<31990:pubkey:d-tag>"]
 */
export const GRIMOIRE_CLIENT_TAG: [string, string, string] = [
  "client",
  "grimoire",
  GRIMOIRE_APP_ADDRESS,
];
