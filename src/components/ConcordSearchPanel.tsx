/**
 * Search results, in the pane the timeline would otherwise be in.
 *
 * Results REPLACE the channel rather than sitting beside it — armada's model,
 * and the one that fits a scan spanning every channel: a result list narrower
 * than the conversation it came from would have nowhere to say which channel
 * each hit belongs to.
 *
 * A row is a real answer on its own. Author, channel, time and the matching
 * text are all here, so a click that cannot reach the message — a hit deeper
 * than the jump's page budget — still leaves the reader with what they came
 * for. Which is why the panel says so rather than promising navigation it
 * cannot always deliver.
 */

import { useMemo } from "react";
import { Hash, Loader2, Lock, Search } from "lucide-react";

import { RichText } from "@/components/nostr/RichText";
import Timestamp from "@/components/Timestamp";
import { UserName } from "@/components/nostr/UserName";
import { SEARCH_RESULT_LIMIT } from "@/lib/concord/search";
import { useLocale } from "@/hooks/useLocale";
import type { ConcordSearchHit } from "@/services/concord-search";
import type { NostrEvent } from "@/types/nostr";

/**
 * The hit as grimoire's renderers expect an event.
 *
 * `sig` is empty because a rumor has none — authorship was proved by the seal
 * at ingest, and nothing here re-verifies. The same compromise the timeline
 * already makes for every Concord row.
 */
function hitEvent(hit: ConcordSearchHit): NostrEvent {
  return {
    id: hit.message.rumorId,
    pubkey: hit.message.author,
    kind: hit.message.kind,
    content: hit.message.content,
    tags: hit.message.tags,
    created_at: hit.message.createdAt,
    sig: "",
  } as NostrEvent;
}

export function ConcordSearchPanel({
  hits,
  searching,
  waiting,
  query,
  onOpen,
  thisChannelOnly,
  scopeChannelName,
  onToggleScope,
}: {
  hits: ConcordSearchHit[];
  searching: boolean;
  /** The community has not folded yet, so no scan has started. */
  waiting: boolean;
  query: string;
  /** Open the channel a hit is in and try to land on the message. */
  onOpen: (hit: ConcordSearchHit) => void;
  /** Scope lives here rather than under the box: it describes the RESULTS. */
  thisChannelOnly: boolean;
  /** Absent when no channel is open, which is when scope cannot be narrowed. */
  scopeChannelName?: string;
  onToggleScope?: () => void;
}) {
  const { locale } = useLocale();
  const count = new Intl.NumberFormat(locale).format(hits.length);
  // Built once per result set rather than per render: `RichText` re-parses
  // whenever it is handed a new event object, and a scan re-runs on every
  // message that lands in a channel being searched.
  const events = useMemo(() => hits.map(hitEvent), [hits]);

  return (
    <div className="flex h-full flex-col">
      {/* `h-8` matches the sidebar's search heading exactly. The two sit on the
          same line across the split, so a couple of pixels apart reads as a
          mistake — and padding alone could not hold them level once this side
          gained a button and the other did not. */}
      <div className="flex h-8 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <Search className="size-3 shrink-0" />
        {waiting ? (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> waiting for this
            community to open…
          </span>
        ) : searching ? (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> searching…
          </span>
        ) : (
          <span className="truncate">
            {hits.length === 1 ? "1 result" : `${count} results`}
            {hits.length >= SEARCH_RESULT_LIMIT && " (the newest)"} for “{query}
            ”
          </span>
        )}
        {onToggleScope && scopeChannelName && (
          <button
            type="button"
            onClick={onToggleScope}
            className="ml-auto shrink-0 cursor-crosshair rounded border border-dotted px-1.5 py-0.5 text-[10px] hover:bg-muted/50 hover:text-foreground"
            title="Switch between searching this channel and every channel you can read"
          >
            {thisChannelOnly ? `#${scopeChannelName}` : "everywhere"}
          </button>
        )}
      </div>

      {!searching && !waiting && hits.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <p className="max-w-sm">
            Nothing here matches “{query}”. Only messages this device has
            already decrypted can be searched — no relay can read them.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {hits.map((hit, i) => {
            const Icon = hit.channelPrivate ? Lock : Hash;
            return (
              // A div, not a button: `RichText` renders links and mentions,
              // and an anchor inside a button is invalid markup that browsers
              // resolve by swallowing one of the two clicks.
              <div
                key={hit.message.rumorId}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(hit)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(hit);
                  }
                }}
                className="flex w-full cursor-crosshair flex-col items-start gap-0.5 border-b px-3 py-1.5 text-left hover:bg-muted/50"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon className="size-3 shrink-0" />
                  <span className="truncate">{hit.channelName}</span>
                </span>
                <span className="flex items-center gap-2">
                  <UserName
                    pubkey={hit.message.author}
                    className="text-sm font-semibold"
                  />
                  <span className="text-xs text-muted-foreground">
                    <Timestamp timestamp={hit.message.createdAt} />
                  </span>
                </span>
                <RichText
                  event={events[i]}
                  className="w-full break-words text-sm leading-tight"
                  options={{ showMedia: false, showEventEmbeds: false }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
