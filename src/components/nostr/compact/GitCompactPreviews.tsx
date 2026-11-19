/**
 * One-line previews for NIP-34 git events.
 *
 * Every row has the same shape, so a feed that mixes projects scans in
 * columns:
 *
 *   [repository]  [what the event says]  [detail that may be cut]
 *
 * The repository leads because it is the context that tells two rows apart,
 * and it is always in the event's own tags (see `src/lib/git-compact.ts`).
 * The title is the only foreground text. A status verb carries the colour
 * `StatusIndicator` gives that status elsewhere.
 *
 * ONE RULE DECIDES WHAT A NARROW ROW KEEPS: context yields to the title. A
 * phone leaves the preview about twenty characters, and "darkm… Enable in…"
 * names neither the repository nor the pull request. So when a row has a
 * title, its repository is shown only once the preview is wide enough for
 * both (a container query, not a viewport one — a tiled window can be as
 * narrow as a phone). When a row has no title, the repository is the most
 * identifying thing it has and stays. Commit ids are context in every row and
 * follow the same threshold. Under 10rem a row keeps a single thing.
 *
 * NOTHING HERE FETCHES. A status and a PR update point at another event, and
 * the title of that event is the best thing the row could show — but a feed
 * of statuses would then send a lookup per row, and send it again each time a
 * row whose ticket no relay holds scrolls back into view. So the ticket is
 * read with `useStoredEvent`, which watches the EventStore and never loads
 * (`eventStore.event()` would: see that hook). In a git feed the ticket has
 * usually arrived through the same subscription, and the row picks it up
 * reactively when it does. Until then the row is built from tags alone and
 * still reads as a sentence — "wyrd closed not worth it".
 *
 * The row opens the event, as every compact row does. Nothing inside the
 * preview is a second click target: on a 390px line the author already is
 * one, and a tappable repository name would leave little of the row to open
 * the event with.
 *
 * All text is rendered as React text nodes. Subjects, identifiers and
 * comments are untrusted tag values and are never parsed as markup.
 */

import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { cn } from "@/lib/utils";
import { useStoredEvent } from "@/hooks/useStoredEvent";
import {
  getRepositoryDescription,
  getRepositoryName,
} from "@/lib/nip34-helpers";
import {
  getGitRepositoryRef,
  getGitStatusVerb,
  getGitSubject,
  getPullRequestUpdateTargetId,
  getRepositoryStateSummary,
  getStatusComment,
  getStatusMergeCommit,
  getStatusRootId,
  getTicketNoun,
  shortCommit,
  singleLine,
  type GitRepositoryRef,
  type GitStatusVerb,
} from "@/lib/git-compact";
import { getStatusColorClass } from "../StatusIndicator";

/** The preview is its own query container: see "context yields" above. */
const ROW = "@container flex w-full min-w-0 items-center gap-1.5 text-sm";

/** Context that a narrow preview drops: present from 24rem of width up. */
const WIDE_ONLY = "hidden @sm:block";

/**
 * Dropped by a preview under 10rem, which is what a phone gives each of two
 * side-by-side windows: about eight characters. Splitting those between a
 * repository and a verb left "d… m…", so such a row keeps one thing.
 */
const NOT_TINY = "hidden @[10rem]:block";

/**
 * A short word that keeps its width ("pushed", "merged"). Under 10rem it may
 * truncate instead: a word that refused to shrink there was sliced mid-letter
 * by the row's edge.
 */
const SHORT_WORD = "min-w-0 truncate @[10rem]:shrink-0";

/**
 * The repository, and what it gives way to.
 *
 * - `title`: beside a title it is capped at 40% of the preview and gone on a
 *   narrow one.
 * - `word`: with no title it is the row's identity and stays, truncating when
 *   the line runs out, until the preview is too small for it and the verb.
 * - `nothing`: it is all the row has.
 */
function Repo({
  repo,
  yieldsTo,
}: {
  repo: GitRepositoryRef | undefined;
  yieldsTo: "title" | "word" | "nothing";
}) {
  if (!repo) return null;
  return (
    <span
      className={cn(
        "min-w-0 truncate text-muted-foreground",
        yieldsTo === "title" && "max-w-[40%] shrink-0",
        yieldsTo === "title" && WIDE_ONLY,
        yieldsTo === "word" && NOT_TINY,
      )}
      title={repo.identifier}
    >
      {repo.label}
    </span>
  );
}

/** The one foreground element: a ticket title, a repository name. */
function Title({ children }: { children: string }) {
  return (
    <span className="min-w-0 truncate text-foreground" title={children}>
      {children}
    </span>
  );
}

/**
 * Muted words that stand where a title would be, or beside one. `fixed` words
 * are short and keep their width ("pushed"); `capped` ones keep theirs up to
 * 45% of the preview (a branch name); the rest truncate like a title.
 */
function Words({
  children,
  fit = "truncate",
  className,
}: {
  children: string;
  fit?: "truncate" | "fixed" | "capped";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground",
        className,
        fit === "fixed" && SHORT_WORD,
        fit === "capped" && "max-w-[45%] shrink-0 truncate",
        fit === "truncate" && "min-w-0 truncate",
      )}
    >
      {children}
    </span>
  );
}

/**
 * A trailing detail (a description, a status comment). Its flex basis is
 * zero, so it claims no width of its own and only fills what the rest of the
 * row leaves. A large `flex-shrink` does not do this: shrink is proportional,
 * so the title still lost a fraction of a pixel, and a fraction of a pixel is
 * enough for `text-overflow` to replace its last characters with an ellipsis.
 */
function Detail({ children }: { children: string }) {
  return (
    <span
      className="min-w-0 flex-1 basis-0 truncate text-muted-foreground"
      title={children}
    >
      {children}
    </span>
  );
}

/** A short commit id. Always context: a narrow preview drops it. */
function Commit({ hash }: { hash: string }) {
  return (
    <code
      className={cn(
        "shrink-0 font-mono text-xs text-muted-foreground",
        WIDE_ONLY,
      )}
    >
      {hash}
    </code>
  );
}

const VERB_KIND: Record<GitStatusVerb, number> = {
  opened: 1630,
  resolved: 1631,
  merged: 1631,
  closed: 1632,
  draft: 1633,
};

function Verb({ verb }: { verb: GitStatusVerb }) {
  return (
    <span className={cn(SHORT_WORD, getStatusColorClass(VERB_KIND[verb]))}>
      {verb}
    </span>
  );
}

const UNTITLED: Record<number, string> = {
  1617: "Untitled patch",
  1618: "Untitled pull request",
  1621: "Untitled issue",
};

/** Issue (1621), pull request (1618) and patch (1617): repository and title. */
export function GitTicketCompactPreview({ event }: { event: NostrEvent }) {
  const subject = getGitSubject(event);
  const repo = getGitRepositoryRef(event);
  return (
    <span className={ROW}>
      <Repo repo={repo} yieldsTo={subject ? "title" : "nothing"} />
      {subject ? (
        <Title>{subject}</Title>
      ) : (
        <Words className={repo && NOT_TINY}>
          {UNTITLED[event.kind] ?? "Untitled"}
        </Words>
      )}
    </span>
  );
}

/** Pull request update (1619): the new tip, and the PR it moves if known. */
export function PullRequestUpdateCompactPreview({
  event,
}: {
  event: NostrEvent;
}) {
  const commit = shortCommit(getTagValue(event, "c"));
  const pullRequest = useStoredEvent(getPullRequestUpdateTargetId(event));
  const title = pullRequest ? getGitSubject(pullRequest) : undefined;
  return (
    <span className={ROW}>
      <Repo
        repo={getGitRepositoryRef(event)}
        yieldsTo={title ? "title" : "word"}
      />
      <Words fit="fixed">{commit ? "pushed" : "updated"}</Words>
      {commit && <Commit hash={commit} />}
      {title ? (
        <Title>{title}</Title>
      ) : (
        <Detail>{commit ? "to a pull request" : "a pull request"}</Detail>
      )}
    </span>
  );
}

/** Status (1630–1633): verb, the ticket it marks if known, the comment. */
export function GitStatusCompactPreview({ event }: { event: NostrEvent }) {
  const root = useStoredEvent(getStatusRootId(event));
  const verb = getGitStatusVerb(event, root);
  const title = root ? getGitSubject(root) : undefined;
  const noun = getTicketNoun(root);
  const commit = getStatusMergeCommit(event);
  const comment = getStatusComment(event);
  return (
    <span className={ROW}>
      <Repo
        repo={getGitRepositoryRef(event)}
        yieldsTo={title ? "title" : "word"}
      />
      {verb && <Verb verb={verb} />}
      {title ? (
        <Title>{title}</Title>
      ) : noun ? (
        <Words>{`an untitled ${noun}`}</Words>
      ) : null}
      {commit && <Commit hash={commit} />}
      {comment && <Detail>{comment}</Detail>}
    </span>
  );
}

/** Repository announcement (30617): name, then the description. */
export function RepositoryCompactPreview({ event }: { event: NostrEvent }) {
  const name =
    singleLine(getRepositoryName(event)) ?? getGitRepositoryRef(event)?.label;
  const description = singleLine(getRepositoryDescription(event));
  return (
    <span className={ROW}>
      {name ? <Title>{name}</Title> : <Words>Unnamed repository</Words>}
      {description && <Detail>{description}</Detail>}
    </span>
  );
}

/**
 * Repository state (30618): the event is about the repository itself, so its
 * name is the title, followed by the HEAD branch and the commit it is at.
 */
export function RepositoryStateCompactPreview({
  event,
}: {
  event: NostrEvent;
}) {
  const repo = getGitRepositoryRef(event);
  const { branch, commit, refCount } = getRepositoryStateSummary(event);
  const refs =
    refCount > 0 ? `${refCount} ${refCount === 1 ? "ref" : "refs"}` : "no refs";
  return (
    <span className={ROW}>
      {repo ? (
        <span
          className="min-w-0 truncate text-foreground"
          title={repo.identifier}
        >
          {repo.label}
        </span>
      ) : (
        <Words>Unnamed repository</Words>
      )}
      <Words fit="capped" className={repo && NOT_TINY}>
        {branch ?? refs}
      </Words>
      {commit && <Commit hash={commit} />}
    </span>
  );
}
