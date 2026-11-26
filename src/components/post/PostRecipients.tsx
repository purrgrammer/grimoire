import { AlertTriangle, Loader2 } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import type { PostRecipient, RecipientVia } from "@/lib/post-template";
import type { InboxResolution } from "@/services/relay-selection";
import { PostDisclosure } from "./PostDisclosure";

const VIA_LABEL: Record<RecipientVia, string> = {
  mention: "mention",
  "address-author": "quoted event author",
  "quote-author": "quoted note author",
};

type InboxState = "pending" | "ok" | "problem";

/** Where this person reads, in a few words. */
function inboxText(resolution: InboxResolution): {
  text: string;
  state: InboxState;
} {
  switch (resolution.status) {
    case "pending":
      return { text: "looking up…", state: "pending" };
    case "resolved": {
      const n = resolution.relays.length;
      const blocked =
        resolution.blocked.length > 0
          ? ` (${resolution.blocked.length} blocked)`
          : "";
      if (n === 0)
        return { text: `no usable inbox${blocked}`, state: "problem" };
      return {
        text: `${n} inbox${n === 1 ? "" : "es"}${blocked}`,
        state: "ok",
      };
    }
    case "no-list":
      return { text: "no relay list", state: "problem" };
    case "timeout":
      return { text: "lookup timed out", state: "problem" };
    case "error":
      return { text: "lookup failed", state: "problem" };
  }
}

/** Warning icon in the theme's warning colour; the words carry the meaning. */
function WarnIcon() {
  return (
    <AlertTriangle
      className="h-3 w-3 flex-shrink-0 text-warning"
      aria-hidden="true"
    />
  );
}

interface RecipientsSummary {
  tagged: number;
  /** Inbox lookups and quote authors still in flight. */
  pending: number;
  /** Tagged people we found no usable inbox for (no list, timeout, failure). */
  noInbox: number;
  /** Quoted notes not found, so their author is not tagged. */
  quotesMissing: number;
  untagged: number;
}

/** Counts for the collapsed header. Quotes still loading count as pending. */
function summarizeRecipients(
  recipients: PostRecipient[],
  unresolvedQuotes: { status: "pending" | "not-found" }[],
  getInbox: (pubkey: string) => InboxResolution,
): RecipientsSummary {
  const summary = {
    tagged: 0,
    pending: 0,
    noInbox: 0,
    quotesMissing: 0,
    untagged: 0,
  };
  for (const r of recipients) {
    if (r.excluded) {
      summary.untagged++;
      continue;
    }
    summary.tagged++;
    const state = inboxText(getInbox(r.pubkey)).state;
    if (state === "pending") summary.pending++;
    if (state === "problem") summary.noInbox++;
  }
  for (const q of unresolvedQuotes) {
    if (q.status === "pending") summary.pending++;
    else summary.quotesMissing++;
  }
  return summary;
}

function SummaryMeta({ summary }: { summary: RecipientsSummary }) {
  const parts: string[] = [String(summary.tagged)];
  if (summary.pending > 0) parts.push(`${summary.pending} looking up`);
  if (summary.noInbox > 0) parts.push(`${summary.noInbox} no inbox`);
  if (summary.quotesMissing > 0)
    parts.push(`${summary.quotesMissing} quote not found`);
  if (summary.untagged > 0) parts.push(`${summary.untagged} untagged`);
  return (
    <span className="inline-flex items-center gap-1">
      {summary.pending > 0 && (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      )}
      {summary.pending === 0 && summary.noInbox + summary.quotesMissing > 0 && (
        <WarnIcon />
      )}
      {parts.join(" · ")}
    </span>
  );
}

interface PostRecipientsProps {
  recipients: PostRecipient[];
  /** Quoted notes whose author is not known yet — and so not tagged. */
  unresolvedQuotes: { id: string; status: "pending" | "not-found" }[];
  getInbox: (pubkey: string) => InboxResolution;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExclude: (pubkey: string) => void;
  onInclude: (pubkey: string) => void;
}

/**
 * Who the note tags, why, and where they read — with a way to untag.
 *
 * Collapsed by default: the header carries the count and anything pending
 * or wrong. Untagging removes that person's `p` tag from the signed note
 * (and with it their inbox relays). The mention or quote stays in the text.
 */
export function PostRecipients({
  recipients,
  unresolvedQuotes,
  getInbox,
  disabled,
  open,
  onOpenChange,
  onExclude,
  onInclude,
}: PostRecipientsProps) {
  if (recipients.length === 0 && unresolvedQuotes.length === 0) return null;
  const summary = summarizeRecipients(recipients, unresolvedQuotes, getInbox);

  return (
    <PostDisclosure
      label="Tagged"
      meta={<SummaryMeta summary={summary} />}
      open={open}
      onOpenChange={onOpenChange}
      testId="post-recipients"
    >
      <ul className="space-y-1">
        {recipients.map((recipient) => {
          const inbox = recipient.excluded
            ? { text: "untagged", state: "ok" as InboxState }
            : inboxText(getInbox(recipient.pubkey));
          return (
            <li
              key={recipient.pubkey}
              className="flex items-start justify-between gap-3 py-1"
              data-testid={`recipient-${recipient.pubkey}`}
            >
              <div
                className={`min-w-0 flex-1 ${recipient.excluded ? "opacity-70" : ""}`}
              >
                <div className="text-sm truncate">
                  <UserName pubkey={recipient.pubkey} />
                </div>
                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1">
                  <span>
                    {recipient.via.map((v) => VIA_LABEL[v]).join(", ")}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    {inbox.state === "pending" && (
                      <Loader2
                        className="h-3 w-3 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    {inbox.state === "problem" && <WarnIcon />}
                    {inbox.text}
                  </span>
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  recipient.excluded
                    ? onInclude(recipient.pubkey)
                    : onExclude(recipient.pubkey)
                }
                className="flex-shrink-0 text-xs text-muted-foreground px-2 py-1 rounded-sm border border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {recipient.excluded ? "Tag" : "Untag"}
              </button>
            </li>
          );
        })}
        {unresolvedQuotes.map((quote) => (
          <li
            key={quote.id}
            className="py-1 text-xs text-muted-foreground inline-flex items-center gap-1"
            data-testid={`quote-${quote.id}`}
          >
            {quote.status === "pending" ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Quoted note: looking up author…
              </>
            ) : (
              <>
                <WarnIcon />
                Quoted note not found; author not tagged.
              </>
            )}
          </li>
        ))}
      </ul>
      {summary.untagged > 0 && (
        <p className="text-xs text-muted-foreground pt-1">
          Untagged people stay in the text but get no tag and no inbox copy. The
          note is still public.
        </p>
      )}
    </PostDisclosure>
  );
}
