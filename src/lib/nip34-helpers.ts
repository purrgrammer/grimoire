import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";

/**
 * NIP-34 Helper Functions
 * Utility functions for parsing NIP-34 git event tags
 */

// ============================================================================
// Repository Event Helpers (Kind 30617)
// ============================================================================

/**
 * Get the repository name from a repository event
 * @param event Repository event (kind 30617)
 * @returns Repository name or undefined
 */
export function getRepositoryName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}

/**
 * Get the repository description
 * @param event Repository event (kind 30617)
 * @returns Repository description or undefined
 */
export function getRepositoryDescription(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "description");
}

/**
 * Get the repository identifier (d tag)
 * @param event Repository event (kind 30617)
 * @returns Repository identifier or undefined
 */
export function getRepositoryIdentifier(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/**
 * Get all clone URLs from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of clone URLs
 */
export function getCloneUrls(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "clone").map((t) => t[1]);
}

/**
 * Get all web URLs from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of web URLs
 */
export function getWebUrls(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "web").map((t) => t[1]);
}

/**
 * Get all maintainer pubkeys from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of maintainer pubkeys
 */
export function getMaintainers(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === "maintainers")
    .map((t) => t[1])
    .filter((p: string) => p !== event.pubkey);
}

/**
 * Get relay hints for patches and issues
 * @param event Repository event (kind 30617)
 * @returns Array of relay URLs
 */
export function getRepositoryRelays(event: NostrEvent): string[] {
  const relaysTag = event.tags.find((t) => t[0] === "relays");
  if (!relaysTag) return [];
  const [, ...relays] = relaysTag;
  return relays;
}

// ============================================================================
// Issue Event Helpers (Kind 1621)
// ============================================================================

/**
 * Get the issue title/subject
 * @param event Issue event (kind 1621)
 * @returns Issue title or undefined
 */
export function getIssueTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "subject");
}

/**
 * Get all issue labels/tags
 * @param event Issue event (kind 1621)
 * @returns Array of label strings
 */
export function getIssueLabels(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
}

/**
 * Get the repository address pointer for an issue
 * @param event Issue event (kind 1621)
 * @returns Repository address pointer (a tag) or undefined
 */
export function getIssueRepositoryAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Get the repository owner pubkey for an issue
 * @param event Issue event (kind 1621)
 * @returns Repository owner pubkey or undefined
 */
export function getIssueRepositoryOwner(event: NostrEvent): string | undefined {
  return getTagValue(event, "p");
}

// ============================================================================
// Patch Event Helpers (Kind 1617)
// ============================================================================

/**
 * Get the patch subject from content or subject tag
 * @param event Patch event (kind 1617)
 * @returns Patch subject/title or undefined
 */
export function getPatchSubject(event: NostrEvent): string | undefined {
  // Try subject tag first
  const subjectTag = getTagValue(event, "subject");
  if (subjectTag) return subjectTag;

  // Try to extract from content (first line or "Subject:" header from git format-patch)
  const content = event.content.trim();
  const subjectMatch = content.match(/^Subject:\s*(.+?)$/m);
  if (subjectMatch) return subjectMatch[1].trim();

  // Fallback to first line
  const firstLine = content.split("\n")[0];
  return firstLine?.length > 0 ? firstLine : undefined;
}

/**
 * Get the commit ID from a patch event
 * @param event Patch event (kind 1617)
 * @returns Commit ID or undefined
 */
export function getPatchCommitId(event: NostrEvent): string | undefined {
  return getTagValue(event, "commit");
}

/**
 * Get the parent commit ID from a patch event
 * @param event Patch event (kind 1617)
 * @returns Parent commit ID or undefined
 */
export function getPatchParentCommit(event: NostrEvent): string | undefined {
  return getTagValue(event, "parent-commit");
}

/**
 * Get committer info from a patch event
 * @param event Patch event (kind 1617)
 * @returns Committer object with name, email, timestamp, timezone or undefined
 */
export function getPatchCommitter(
  event: NostrEvent,
):
  | { name: string; email: string; timestamp: string; timezone: string }
  | undefined {
  const committerTag = event.tags.find((t) => t[0] === "committer");
  if (!committerTag || committerTag.length < 5) return undefined;

  const [, name, email, timestamp, timezone] = committerTag;
  return { name, email, timestamp, timezone };
}

/**
 * Get the repository address for a patch
 * @param event Patch event (kind 1617)
 * @returns Repository address pointer (a tag) or undefined
 */
export function getPatchRepositoryAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Check if patch is root/first in series
 * @param event Patch event (kind 1617)
 * @returns True if this is a root patch
 */
export function isPatchRoot(event: NostrEvent): boolean {
  return event.tags.some((t) => t[0] === "t" && t[1] === "root");
}

/**
 * Check if patch is first in a revision series
 * @param event Patch event (kind 1617)
 * @returns True if this is a root revision
 */
export function isPatchRootRevision(event: NostrEvent): boolean {
  return event.tags.some((t) => t[0] === "t" && t[1] === "root-revision");
}

// ============================================================================
// Pull Request Event Helpers (Kind 1618)
// ============================================================================

/**
 * Get the PR subject/title
 * @param event PR event (kind 1618)
 * @returns PR subject or undefined
 */
export function getPullRequestSubject(event: NostrEvent): string | undefined {
  return getTagValue(event, "subject");
}

/**
 * Get PR labels
 * @param event PR event (kind 1618)
 * @returns Array of label strings
 */
export function getPullRequestLabels(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "t").map((t) => t[1]);
}

/**
 * Get the current commit ID (tip of PR branch)
 * @param event PR event (kind 1618)
 * @returns Commit ID or undefined
 */
export function getPullRequestCommitId(event: NostrEvent): string | undefined {
  return getTagValue(event, "c");
}

/**
 * Get all clone URLs for a PR
 * @param event PR event (kind 1618)
 * @returns Array of clone URLs
 */
export function getPullRequestCloneUrls(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "clone").map((t) => t[1]);
}

/**
 * Get the branch name for a PR
 * @param event PR event (kind 1618)
 * @returns Branch name or undefined
 */
export function getPullRequestBranchName(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "branch-name");
}

/**
 * Get the merge base commit ID
 * @param event PR event (kind 1618)
 * @returns Merge base commit ID or undefined
 */
export function getPullRequestMergeBase(event: NostrEvent): string | undefined {
  return getTagValue(event, "merge-base");
}

/**
 * Get the repository address for a PR
 * @param event PR event (kind 1618)
 * @returns Repository address pointer (a tag) or undefined
 */
export function getPullRequestRepositoryAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

// ============================================================================
// Repository State Event Helpers (Kind 30618)
// ============================================================================

/**
 * Get the HEAD reference from a repository state event
 * @param event Repository state event (kind 30618)
 * @returns HEAD reference (e.g., "ref: refs/heads/main") or undefined
 */
export function getRepositoryStateHead(event: NostrEvent): string | undefined {
  return getTagValue(event, "HEAD");
}

/**
 * Parse HEAD reference to extract branch name
 * @param headRef HEAD reference string (e.g., "ref: refs/heads/main")
 * @returns Branch name (e.g., "main") or undefined
 */
export function parseHeadBranch(
  headRef: string | undefined,
): string | undefined {
  if (!headRef) return undefined;
  const match = headRef.match(/^ref:\s*refs\/heads\/(.+)$/);
  return match ? match[1] : undefined;
}

/**
 * Get all git refs from a repository state event
 * @param event Repository state event (kind 30618)
 * @returns Array of { ref: string, hash: string } objects
 */
export function getRepositoryStateRefs(
  event: NostrEvent,
): Array<{ ref: string; hash: string }> {
  return event.tags
    .filter((t) => t[0].startsWith("refs/"))
    .map((t) => ({ ref: t[0], hash: t[1] }));
}

/**
 * Get the commit hash that HEAD points to
 * @param event Repository state event (kind 30618)
 * @returns Commit hash or undefined
 */
export function getRepositoryStateHeadCommit(
  event: NostrEvent,
): string | undefined {
  const headRef = getRepositoryStateHead(event);
  const branch = parseHeadBranch(headRef);
  if (!branch) return undefined;

  // Find the refs/heads/{branch} tag
  const branchRef = `refs/heads/${branch}`;
  const branchTag = event.tags.find((t) => t[0] === branchRef);
  return branchTag ? branchTag[1] : undefined;
}

/**
 * Get branches from repository state refs
 * @param event Repository state event (kind 30618)
 * @returns Array of { name: string, hash: string } objects
 */
export function getRepositoryStateBranches(
  event: NostrEvent,
): Array<{ name: string; hash: string }> {
  return event.tags
    .filter((t) => t[0].startsWith("refs/heads/"))
    .map((t) => ({
      name: t[0].replace("refs/heads/", ""),
      hash: t[1],
    }));
}

/**
 * Get tags from repository state refs
 * @param event Repository state event (kind 30618)
 * @returns Array of { name: string, hash: string } objects
 */
export function getRepositoryStateTags(
  event: NostrEvent,
): Array<{ name: string; hash: string }> {
  return event.tags
    .filter((t) => t[0].startsWith("refs/tags/"))
    .map((t) => ({
      name: t[0].replace("refs/tags/", ""),
      hash: t[1],
    }));
}
