import { Loader2 } from "lucide-react";
import { UserName } from "@/components/nostr/UserName";
import type { PostRecipient, RecipientVia } from "@/lib/post-template";
import type { InboxResolution } from "@/services/relay-selection";

const VIA_LABEL: Record<RecipientVia, string> = {
  mention: "mentioned",
  "address-author": "author of a quoted event",
  "quote-author": "author of a quoted note",
};

function viaText(via: RecipientVia[]): string {
  return via.map((v) => VIA_LABEL[v]).join(", ");
}

/** What we know about where this person reads, in words. */
function inboxText(resolution: InboxResolution): {
  text: string;
  pending?: boolean;
  warn?: boolean;
} {
  switch (resolution.status) {
    case "pending":
      return { text: "finding inbox relays…", pending: true };
    case "resolved": {
      const n = resolution.relays.length;
      const blocked =
        resolution.blocked.length > 0
          ? ` (${resolution.blocked.length} blocked by you)`
          : "";
      if (n === 0)
        return { text: `no usable inbox relays${blocked}`, warn: true };
      return { text: `${n} inbox relay${n === 1 ? "" : "s"}${blocked}` };
    }
    case "no-list":
      return { text: "no relay list found", warn: true };
    case "timeout":
      return { text: "relay list lookup timed out", warn: true };
    case "error":
      return { text: "couldn't look up relay list", warn: true };
  }
}

interface PostRecipientsProps {
  recipients: PostRecipient[];
  /** Quoted notes whose author is not known yet — and so not tagged. */
  unresolvedQuotes: { id: string; status: "pending" | "not-found" }[];
  getInbox: (pubkey: string) => InboxResolution;
  disabled: boolean;
  onExclude: (pubkey: string) => void;
  onInclude: (pubkey: string) => void;
}

/**
 * Who the note tags, why, and where they read — with a way to untag.
 *
 * Untagging removes that person's `p` tag from the signed note (and with it
 * their inbox relays). The mention or quote stays in the text.
 */
export function PostRecipients({
  recipients,
  unresolvedQuotes,
  getInbox,
  disabled,
  onExclude,
  onInclude,
}: PostRecipientsProps) {
  if (recipients.length === 0 && unresolvedQuotes.length === 0) return null;
  const tagged = recipients.filter((r) => !r.excluded).length;
  const anyExcluded = recipients.some((r) => r.excluded);

  return (
    <section aria-labelledby="post-recipients-heading" className="space-y-1">
      <h3
        id="post-recipients-heading"
        className="text-sm text-muted-foreground font-normal"
      >
        Tagged people ({tagged})
      </h3>
      <ul className="space-y-1">
        {recipients.map((recipient) => {
          const inbox = recipient.excluded
            ? { text: "not tagged" }
            : inboxText(getInbox(recipient.pubkey));
          return (
            <li
              key={recipient.pubkey}
              className="flex items-start justify-between gap-3 py-1"
              data-testid={`recipient-${recipient.pubkey}`}
            >
              <div
                className={`min-w-0 flex-1 ${recipient.excluded ? "opacity-60" : ""}`}
              >
                <div className="text-sm truncate">
                  <UserName pubkey={recipient.pubkey} />
                </div>
                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-1">
                  <span>{viaText(recipient.via)}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`inline-flex items-center gap-1 ${"warn" in inbox && inbox.warn ? "text-amber-500" : ""}`}
                  >
                    {"pending" in inbox && inbox.pending && (
                      <Loader2
                        className="h-3 w-3 animate-spin"
                        aria-hidden="true"
                      />
                    )}
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
                {recipient.excluded ? "Tag again" : "Don't tag"}
              </button>
            </li>
          );
        })}
        {unresolvedQuotes.map((quote) => (
          <li
            key={quote.id}
            className="py-1 text-xs text-muted-foreground"
            data-testid={`quote-${quote.id}`}
          >
            {quote.status === "pending" ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Quoted note: finding its author…
              </span>
            ) : (
              <span className="text-amber-500">
                Quoted note not found, so its author isn&apos;t tagged.
              </span>
            )}
          </li>
        ))}
      </ul>
      {anyExcluded && (
        <p className="text-xs text-muted-foreground">
          Untagged people stay mentioned in the text, but the note carries no
          tag for them — the tag clients use to notify — and their inbox relays
          aren't added. The note is still public, so they can still see it.
        </p>
      )}
    </section>
  );
}
