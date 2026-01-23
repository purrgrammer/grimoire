import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import { parseReplaceableAddress } from "applesauce-core/helpers/pointers";

/**
 * NIP-34 Helper Functions
 * Utility functions for parsing NIP-34 git event tags
 *
 * All helper functions use applesauce's getOrComputeCachedValue to cache
 * computed values on the event object itself. This means you don't need
 * useMemo when calling these functions - they will return cached values
 * on subsequent calls for the same event.
 */

// Cache symbols for memoization
const CloneUrlsSymbol = Symbol("cloneUrls");
const WebUrlsSymbol = Symbol("webUrls");
const MaintainersSymbol = Symbol("maintainers");
const RepositoryRelaysSymbol = Symbol("repositoryRelays");
const IssueLabelsSymbol = Symbol("issueLabels");
const PatchSubjectSymbol = Symbol("patchSubject");
const PatchCommitterSymbol = Symbol("patchCommitter");
const IsPatchRootSymbol = Symbol("isPatchRoot");
const IsPatchRootRevisionSymbol = Symbol("isPatchRootRevision");
const PullRequestLabelsSymbol = Symbol("pullRequestLabels");
const PullRequestCloneUrlsSymbol = Symbol("pullRequestCloneUrls");
const RepositoryStateRefsSymbol = Symbol("repositoryStateRefs");
const RepositoryStateBranchesSymbol = Symbol("repositoryStateBranches");
const RepositoryStateTagsSymbol = Symbol("repositoryStateTags");
const StatusRootEventIdSymbol = Symbol("statusRootEventId");
const StatusRootRelayHintSymbol = Symbol("statusRootRelayHint");

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
  return getOrComputeCachedValue(event, CloneUrlsSymbol, () =>
    event.tags.filter((t) => t[0] === "clone").map((t) => t[1]),
  );
}

/**
 * Get all web URLs from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of web URLs
 */
export function getWebUrls(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, WebUrlsSymbol, () =>
    event.tags.filter((t) => t[0] === "web").map((t) => t[1]),
  );
}

/**
 * Get all maintainer pubkeys from a repository event
 * @param event Repository event (kind 30617)
 * @returns Array of maintainer pubkeys
 */
export function getMaintainers(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, MaintainersSymbol, () =>
    event.tags
      .filter((t) => t[0] === "maintainers")
      .map((t) => t[1])
      .filter((p: string) => p !== event.pubkey),
  );
}

/**
 * Get relay hints for patches and issues
 * @param event Repository event (kind 30617)
 * @returns Array of relay URLs
 */
export function getRepositoryRelays(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, RepositoryRelaysSymbol, () => {
    const relaysTag = event.tags.find((t) => t[0] === "relays");
    if (!relaysTag) return [];
    const [, ...relays] = relaysTag;
    return relays;
  });
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
  return getOrComputeCachedValue(event, IssueLabelsSymbol, () =>
    event.tags.filter((t) => t[0] === "t").map((t) => t[1]),
  );
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
  return getOrComputeCachedValue(event, PatchSubjectSymbol, () => {
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
  });
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
  return getOrComputeCachedValue(event, PatchCommitterSymbol, () => {
    const committerTag = event.tags.find((t) => t[0] === "committer");
    if (!committerTag || committerTag.length < 5) return undefined;

    const [, name, email, timestamp, timezone] = committerTag;
    return { name, email, timestamp, timezone };
  });
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
  return getOrComputeCachedValue(event, IsPatchRootSymbol, () =>
    event.tags.some((t) => t[0] === "t" && t[1] === "root"),
  );
}

/**
 * Check if patch is first in a revision series
 * @param event Patch event (kind 1617)
 * @returns True if this is a root revision
 */
export function isPatchRootRevision(event: NostrEvent): boolean {
  return getOrComputeCachedValue(event, IsPatchRootRevisionSymbol, () =>
    event.tags.some((t) => t[0] === "t" && t[1] === "root-revision"),
  );
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
  return getOrComputeCachedValue(event, PullRequestLabelsSymbol, () =>
    event.tags.filter((t) => t[0] === "t").map((t) => t[1]),
  );
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
  return getOrComputeCachedValue(event, PullRequestCloneUrlsSymbol, () =>
    event.tags.filter((t) => t[0] === "clone").map((t) => t[1]),
  );
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
  return getOrComputeCachedValue(event, RepositoryStateRefsSymbol, () =>
    event.tags
      .filter((t) => t[0].startsWith("refs/"))
      .map((t) => ({ ref: t[0], hash: t[1] })),
  );
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
  return getOrComputeCachedValue(event, RepositoryStateBranchesSymbol, () =>
    event.tags
      .filter((t) => t[0].startsWith("refs/heads/"))
      .map((t) => ({
        name: t[0].replace("refs/heads/", ""),
        hash: t[1],
      })),
  );
}

/**
 * Get tags from repository state refs
 * @param event Repository state event (kind 30618)
 * @returns Array of { name: string, hash: string } objects
 */
export function getRepositoryStateTags(
  event: NostrEvent,
): Array<{ name: string; hash: string }> {
  return getOrComputeCachedValue(event, RepositoryStateTagsSymbol, () =>
    event.tags
      .filter((t) => t[0].startsWith("refs/tags/"))
      .map((t) => ({
        name: t[0].replace("refs/tags/", ""),
        hash: t[1],
      })),
  );
}

// ============================================================================
// Status Event Helpers (Kind 1630-1633)
// ============================================================================

/**
 * Status types for NIP-34 status events
 */
export type IssueStatusType = "open" | "resolved" | "closed" | "draft";

/**
 * Map kind numbers to status types
 */
export const STATUS_KIND_MAP: Record<number, IssueStatusType> = {
  1630: "open",
  1631: "resolved",
  1632: "closed",
  1633: "draft",
};

/**
 * Get the status type from a status event kind
 * @param kind Event kind (1630-1633)
 * @returns Status type or undefined if not a status kind
 */
export function getStatusType(kind: number): IssueStatusType | undefined {
  return STATUS_KIND_MAP[kind];
}

/**
 * Get the root event ID being referenced by a status event
 * The root is the original issue/patch/PR being marked with a status
 * @param event Status event (kind 1630-1633)
 * @returns Event ID or undefined
 */
export function getStatusRootEventId(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, StatusRootEventIdSymbol, () => {
    // Look for e tag with "root" marker
    const rootTag = event.tags.find((t) => t[0] === "e" && t[3] === "root");
    if (rootTag) return rootTag[1];

    // Fallback: first e tag without a marker or with empty marker
    const firstETag = event.tags.find((t) => t[0] === "e");
    return firstETag?.[1];
  });
}

/**
 * Get the relay hint for the root event
 * @param event Status event (kind 1630-1633)
 * @returns Relay URL or undefined
 */
export function getStatusRootRelayHint(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, StatusRootRelayHintSymbol, () => {
    const rootTag = event.tags.find((t) => t[0] === "e" && t[3] === "root");
    if (rootTag && rootTag[2]) return rootTag[2];

    const firstETag = event.tags.find((t) => t[0] === "e");
    return firstETag?.[2] || undefined;
  });
}

/**
 * Get the repository address from a status event
 * @param event Status event (kind 1630-1633)
 * @returns Repository address (a tag) or undefined
 */
export function getStatusRepositoryAddress(
  event: NostrEvent,
): string | undefined {
  return getTagValue(event, "a");
}

/**
 * Check if a kind is a status event kind
 * @param kind Event kind
 * @returns True if kind is 1630-1633
 */
export function isStatusKind(kind: number): boolean {
  return kind >= 1630 && kind <= 1633;
}

/**
 * Get human-readable status label
 * @param kind Event kind (1630-1633)
 * @param forIssue Whether this is for an issue (vs patch/PR)
 * @returns Label string
 */
export function getStatusLabel(kind: number, forIssue = true): string {
  switch (kind) {
    case 1630:
      return "opened";
    case 1631:
      return forIssue ? "resolved" : "merged";
    case 1632:
      return "closed";
    case 1633:
      return "marked as draft";
    default:
      return "updated";
  }
}

/**
 * Get all valid pubkeys that can set status for an issue/patch/PR
 * Valid authors: event author, repository owner (from p tag), and all maintainers
 * @param event Issue, patch, or PR event
 * @param repositoryEvent Optional repository event to get maintainers from
 * @returns Set of valid pubkeys
 */
export function getValidStatusAuthors(
  event: NostrEvent,
  repositoryEvent?: NostrEvent,
): Set<string> {
  const validPubkeys = new Set<string>();

  // Event author can always set status
  validPubkeys.add(event.pubkey);

  // Repository owner from p tag
  const repoOwner = getTagValue(event, "p");
  if (repoOwner) validPubkeys.add(repoOwner);

  // Parse repository address to get owner pubkey using applesauce helper
  const repoAddress =
    getIssueRepositoryAddress(event) ||
    getPatchRepositoryAddress(event) ||
    getPullRequestRepositoryAddress(event);
  if (repoAddress) {
    const parsedRepo = parseReplaceableAddress(repoAddress);
    if (parsedRepo?.pubkey) validPubkeys.add(parsedRepo.pubkey);
  }

  // Add maintainers from repository event
  if (repositoryEvent) {
    const maintainers = getMaintainers(repositoryEvent);
    maintainers.forEach((m) => validPubkeys.add(m));
  }

  return validPubkeys;
}

/**
 * Find the most recent valid status event from a list of status events
 * Valid = from event author, repository owner, or maintainers
 * @param statusEvents Array of status events (kinds 1630-1633)
 * @param validAuthors Set of valid pubkeys (from getValidStatusAuthors)
 * @returns Most recent valid status event or null
 */
export function findCurrentStatus(
  statusEvents: NostrEvent[],
  validAuthors: Set<string>,
): NostrEvent | null {
  if (statusEvents.length === 0) return null;

  // Sort by created_at descending (most recent first)
  const sorted = [...statusEvents].sort((a, b) => b.created_at - a.created_at);

  // Find the most recent status from a valid author
  const validStatus = sorted.find((s) => validAuthors.has(s.pubkey));

  // Return valid status if found, otherwise most recent (may be invalid but show anyway)
  return validStatus || sorted[0];
}
