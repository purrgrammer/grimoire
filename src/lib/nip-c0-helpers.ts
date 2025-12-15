import { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

function getTagValues(event: NostrEvent, tag: string) {
  return event.tags.filter((t) => t[0] === tag).map((t) => t[1]);
}

/**
 * NIP-C0 Code Snippet Helpers
 * Extract metadata from kind 1337 code snippet events
 */

/**
 * Get the programming language
 * @param event - Code snippet event
 * @returns Language name (e.g., "javascript", "python")
 */
export function getCodeLanguage(event: NostrEvent): string | undefined {
  return getTagValue(event, "l");
}

/**
 * Get the code snippet name/filename
 * @param event - Code snippet event
 * @returns Filename (e.g., "hello-world.js")
 */
export function getCodeName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}

/**
 * Get the file extension
 * @param event - Code snippet event
 * @returns Extension without dot (e.g., "js", "py")
 */
export function getCodeExtension(event: NostrEvent): string | undefined {
  return getTagValue(event, "extension");
}

/**
 * Get the code description
 * @param event - Code snippet event
 * @returns Description text
 */
export function getCodeDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description");
}

/**
 * Get the runtime specification
 * @param event - Code snippet event
 * @returns Runtime string (e.g., "node v18.15.0", "python 3.11")
 */
export function getCodeRuntime(event: NostrEvent): string | undefined {
  return getTagValue(event, "runtime");
}

/**
 * Get all licenses
 * @param event - Code snippet event
 * @returns Array of license identifiers (e.g., ["MIT"], ["GPL-3.0-or-later", "Apache-2.0"])
 */
export function getCodeLicenses(event: NostrEvent): string[] {
  return getTagValues(event, "license");
}

/**
 * Get all dependencies
 * @param event - Code snippet event
 * @returns Array of dependency strings
 */
export function getCodeDependencies(event: NostrEvent): string[] {
  return getTagValues(event, "dep");
}

/**
 * Get repository reference
 * @param event - Code snippet event
 * @returns Repository info with type (url or nip34) and value
 */
export function getCodeRepo(
  event: NostrEvent,
):
  | { type: "url"; value: string }
  | { type: "nip34"; value: string }
  | undefined {
  const repoTag = event.tags.find((t) => t[0] === "repo");
  if (!repoTag || !repoTag[1]) return undefined;

  const value = repoTag[1];
  // Check if it's NIP-34 address format (30617:pubkey:dtag)
  if (value.startsWith("30617:")) {
    return { type: "nip34", value };
  }
  return { type: "url", value };
}
