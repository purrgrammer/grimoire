/**
 * What a one-line git row can say from the event alone.
 *
 * The compact view shows `[kind] [author] [preview] [time]`, and the preview
 * used to come from `getEventDisplayTitle`, which has nothing for a repository
 * state, a PR update or a status: their content is empty, so the row was an
 * icon, a name and a date. The repository those events belong to is in their
 * own tags, though — the `a` coordinate on tickets and statuses, the `d` tag
 * on 30617/30618 — so a row can always name its repository without resolving
 * anything. Resolving (the status's root ticket, the update's PR) only adds
 * the ticket's title on top of a line that already stands on its own.
 *
 * Everything here is pure and reads tags as untrusted input: a coordinate
 * missing parts, a pubkey that is not hex, a subject spanning lines or an
 * identifier a hundred characters long all come out as plain strings the row
 * can truncate, never as a crash or a broken pointer.
 */

import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import {
  getIssueTitle,
  getPatchSubject,
  getPullRequestSubject,
  getRepositoryStateHead,
  getRepositoryStateHeadCommit,
  getRepositoryStateRefs,
  getStatusRootEventId,
  parseHeadBranch,
} from "@/lib/nip34-helpers";

export const REPOSITORY_KIND = 30617;
export const REPOSITORY_STATE_KIND = 30618;
export const PATCH_KIND = 1617;
export const PULL_REQUEST_KIND = 1618;
export const ISSUE_KIND = 1621;

const HEX_64 = /^[0-9a-f]{64}$/i;

/** Whether a string is a 64-character hex id or pubkey. */
export function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX_64.test(value);
}

/**
 * Collapse a tag value to one line: tabs, newlines and control characters
 * become single spaces. A subject is a tag the author typed, and a row is one
 * line whatever was typed.
 */
export function singleLine(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex -- the point is to strip them
  const flat = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return flat.length > 0 ? flat : undefined;
}

/** Short form of a commit id. Anything that is not hex is not a commit. */
export function shortCommit(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^[0-9a-f]{7,64}$/i.test(trimmed)) return undefined;
  return trimmed.slice(0, 7).toLowerCase();
}

/**
 * The repository a git event belongs to, named from the event itself.
 *
 * `identifier` is the repo's `d` tag: the slug every git client shows, and in
 * practice the repo's name (five of six announcements sampled had
 * `name === d`). `label` is what a row prints. It differs only for a
 * path-like identifier, which exists in the wild as
 * `<64 hex>/gamestr`: the last segment is the repository by every git
 * convention, and the prefix would otherwise be all a truncated row shows.
 */
export interface GitRepositoryRef {
  identifier: string;
  label: string;
}

function repositoryRef(
  value: string | undefined,
): GitRepositoryRef | undefined {
  const identifier = singleLine(value);
  if (!identifier) return undefined;
  const segments = identifier.split("/").filter((s) => s.trim().length > 0);
  const label = segments[segments.length - 1]?.trim() || identifier;
  return { identifier, label };
}

/**
 * Parse a `30617:<pubkey>:<identifier>` coordinate without throwing.
 *
 * Identifiers may contain colons (`split(":")` would drop everything after the
 * third), so the first two separators are the only ones that matter. A
 * coordinate for another kind, or with a pubkey that is not hex, is not a
 * repository and names nothing.
 */
export function parseRepositoryCoordinate(
  value: unknown,
): GitRepositoryRef | undefined {
  if (typeof value !== "string") return undefined;
  const first = value.indexOf(":");
  const second = first === -1 ? -1 : value.indexOf(":", first + 1);
  if (second === -1) return undefined;
  if (value.slice(0, first) !== String(REPOSITORY_KIND)) return undefined;
  if (!isHex64(value.slice(first + 1, second))) return undefined;
  return repositoryRef(value.slice(second + 1));
}

/**
 * Which repository a git event is about.
 *
 * - 30617 / 30618: the event is the repository (or its state), so its own
 *   `d` tag names it.
 * - everything else (1617, 1618, 1619, 1621, 1630–1633): the `a` coordinate.
 */
export function getGitRepositoryRef(
  event: NostrEvent,
): GitRepositoryRef | undefined {
  if (event.kind === REPOSITORY_KIND || event.kind === REPOSITORY_STATE_KIND) {
    return repositoryRef(getTagValue(event, "d"));
  }
  // The first `a` that parses, not the first `a`: an event can carry a
  // malformed coordinate, or one for another kind, ahead of the real one.
  for (const tag of event.tags) {
    if (tag[0] !== "a") continue;
    const ref = parseRepositoryCoordinate(tag[1]);
    if (ref) return ref;
  }
  return undefined;
}

/**
 * A ticket's own title, flattened to one line. Patches fall back to the
 * `Subject:` header of their `git format-patch` content.
 */
export function getGitSubject(event: NostrEvent): string | undefined {
  switch (event.kind) {
    case ISSUE_KIND:
      return singleLine(getIssueTitle(event));
    case PULL_REQUEST_KIND:
      return singleLine(getPullRequestSubject(event));
    case PATCH_KIND:
      return singleLine(getPatchSubject(event));
    default:
      return singleLine(getTagValue(event, "subject"));
  }
}

/**
 * The id of the ticket a status event marks (its `root` `e` tag), or
 * `undefined` when the tag is missing or is not an event id.
 */
export function getStatusRootId(event: NostrEvent): string | undefined {
  const id = getStatusRootEventId(event);
  return isHex64(id) ? id.toLowerCase() : undefined;
}

/** The id of the pull request a kind-1619 update moves (its `E` tag). */
export function getPullRequestUpdateTargetId(
  event: NostrEvent,
): string | undefined {
  const tag = event.tags.find((t) => t[0] === "E" && isHex64(t[1]));
  return tag ? tag[1].toLowerCase() : undefined;
}

export type GitStatusVerb =
  "opened" | "resolved" | "merged" | "closed" | "draft";

/**
 * The verb a status row leads with.
 *
 * Kind 1631 is "resolved" for an issue and "merged" for a patch or PR, and
 * the row usually does not have the root in hand to tell which. The event
 * says so itself when it carries the merge evidence NIP-34 asks for (`q`
 * tags per applied patch, `merge-commit`, `applied-as-commits`). A root that
 * is in hand overrides that, because its kind is the fact. With neither, the
 * row says "resolved": NIP-34 asks a merge to carry that evidence, so a 1631
 * without it is read as the issue case.
 */
export function getGitStatusVerb(
  event: NostrEvent,
  root?: NostrEvent,
): GitStatusVerb | undefined {
  switch (event.kind) {
    case 1630:
      return "opened";
    case 1632:
      return "closed";
    case 1633:
      return "draft";
    case 1631: {
      if (root) {
        return root.kind === PATCH_KIND || root.kind === PULL_REQUEST_KIND
          ? "merged"
          : "resolved";
      }
      const merged = event.tags.some(
        (t) =>
          t[0] === "q" ||
          t[0] === "merge-commit" ||
          t[0] === "applied-as-commits",
      );
      return merged ? "merged" : "resolved";
    }
    default:
      return undefined;
  }
}

/** What a kind-30618 row can say: the HEAD branch, its commit, the ref count. */
export interface RepositoryStateSummary {
  branch?: string;
  commit?: string;
  refCount: number;
}

export function getRepositoryStateSummary(
  event: NostrEvent,
): RepositoryStateSummary {
  const branch = singleLine(parseHeadBranch(getRepositoryStateHead(event)));
  const commit = shortCommit(getRepositoryStateHeadCommit(event));
  return { branch, commit, refCount: getRepositoryStateRefs(event).length };
}

/** The noun for a resolved ticket, used when a row names what it points at. */
export function getTicketNoun(root: NostrEvent | undefined): string {
  switch (root?.kind) {
    case PATCH_KIND:
      return "patch";
    case PULL_REQUEST_KIND:
      return "pull request";
    case ISSUE_KIND:
      return "issue";
    default:
      return "";
  }
}

/**
 * A status comment as one line of plain words: links and `nostr:` references
 * dropped, whitespace collapsed. The comment is the least of what a status
 * row says, so it is cut first and never rendered as rich text.
 */
export function getStatusComment(event: NostrEvent): string | undefined {
  return singleLine(
    (event.content ?? "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/nostr:[a-z0-9]+/gi, ""),
  );
}

/** The merge commit a kind-1631 names, when it names one. */
export function getStatusMergeCommit(event: NostrEvent): string | undefined {
  if (event.kind !== 1631) return undefined;
  return shortCommit(getTagValue(event, "merge-commit"));
}
