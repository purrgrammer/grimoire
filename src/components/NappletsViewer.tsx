import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Loader2,
  Pin,
  Play,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { nip19 } from "nostr-tools";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserName } from "@/components/nostr/UserName";
import { useAddWindow } from "@/core/state";
import { useAccount } from "@/hooks/useAccount";
import {
  listNapplets,
  setNappletPinned,
  forgetNapplet,
  pointerFromCoordinate,
  type InstalledNapplet,
} from "@/services/napplet-library";
import { requestEvent, requestEvents } from "@/lib/relay-subscription";
import { selectRelaysForFilter } from "@/services/relay-selection";
import defaultEventStore from "@/services/event-store";
import { NAPPLET_KINDS } from "@/lib/napplet-parser";
import {
  getNappletTitle,
  getNappletDescription,
  getNappletIdentifier,
  getNappletRequires,
} from "@/lib/nip5d-helpers";
import type { NostrEvent } from "@/types/nostr";
import { isNsiteKind } from "@/services/nsite-library";
import { NappletDecisions } from "@/components/NappletDecisions";
import {
  getNappletDecisions,
  subscribeNappletDecisions,
  type NappletDecision,
} from "@/services/napplet-acl";

interface Candidate {
  coordinate: string;
  kind: number;
  pubkey: string;
  identifier: string;
  title: string;
  description?: string;
  requires: string[];
  lastRunAt?: number;
  pinned?: boolean;
}

function fromEvent(event: NostrEvent): Candidate {
  const identifier = getNappletIdentifier(event) ?? "";
  return {
    coordinate: `${event.kind}:${event.pubkey}:${identifier}`,
    kind: event.kind,
    pubkey: event.pubkey,
    identifier,
    title: getNappletTitle(event) || identifier || "Napplet",
    description: getNappletDescription(event),
    requires: getNappletRequires(event),
  };
}

function readFollows(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === "p" && t[1]?.length === 64)
    .map((t) => t[1])
    .slice(0, 200);
}

function fromInstalled(entry: InstalledNapplet): Candidate {
  return {
    coordinate: entry.coordinate,
    kind: entry.kind,
    pubkey: entry.pubkey,
    identifier: entry.identifier,
    title: entry.title,
    description: entry.description,
    requires: [],
    lastRunAt: entry.lastRunAt,
    pinned: entry.pinned === 1,
  };
}

function NappletRow({
  candidate,
  onRun,
  onPin,
  onForget,
  decisions,
  onDecisionsChanged,
}: {
  candidate: Candidate;
  onRun: () => void;
  onPin?: () => void;
  onForget?: () => void;
  /**
   * What the user has permanently answered this napplet, already filtered to
   * it. Absent for a row the user has never run, which can have no answers.
   */
  decisions?: NappletDecision[];
  onDecisionsChanged?: () => void;
}) {
  return (
    /* A Card, like a spell and a spellbook — three windows listing things the
       reader owns, in one shape. */
    <Card className="flex flex-col transition-colors hover:border-border">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start gap-2">
          <Boxes className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="truncate">{candidate.title}</span>
              {candidate.pinned && (
                <Pin className="size-3 shrink-0 text-muted-foreground" />
              )}
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              <UserName pubkey={candidate.pubkey} />
            </CardDescription>
          </div>
        </div>
        {candidate.description && (
          <CardDescription className="mt-2 line-clamp-2 text-sm">
            {candidate.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex-1 p-4 pt-0">
        {candidate.requires.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {candidate.requires.map((nap) => (
              <Label key={nap}>{nap}</Label>
            ))}
          </div>
        )}
        {decisions && decisions.length > 0 && (
          <div className="mt-2 space-y-1">
            <NappletDecisions
              decisions={decisions}
              emptyText=""
              onChanged={onDecisionsChanged ?? (() => {})}
            />
            <p className="text-[11px] text-muted-foreground/70">
              Answers apply to one exact version. An update re-asks, and a
              running napplet only loses a permission on its next run.
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-2 p-4 pt-0">
        <div className="flex items-center gap-1">
          {onPin && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-muted-foreground"
              title={candidate.pinned ? "Unpin" : "Pin"}
              onClick={onPin}
            >
              <Pin className="size-3.5" />
            </Button>
          )}
          {onForget && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-muted-foreground hover:text-destructive"
              title="Remove from your apps"
              onClick={onForget}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
        <Button size="sm" className="h-8" onClick={onRun}>
          <Play className="size-3.5 mr-1" />
          Run
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Find and launch napplets.
 *
 * Two sources: what the user has already run — recorded only after
 * verification, so nothing unverifiable is ever listed — and what their
 * contacts publish, discovered over the outbox model.
 */
export function NappletsViewer() {
  const addWindow = useAddWindow();
  const account = useAccount();
  const [installed, setInstalled] = useState<Candidate[]>([]);
  // null means "still looking" — a separate loading flag would mean setting
  // state synchronously on mount, which cascades a render for nothing.
  const [discovered, setDiscovered] = useState<Candidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "yours" | "contacts">("all");

  const [discoveryFailed, setDiscoveryFailed] = useState(false);

  /*
   * Remembered permissions, live. This is the only place a napplet the user is
   * NOT running can be reviewed or revoked, so it has to reflect an answer
   * given anywhere — a running napplet's own popover, another tab — without a
   * reopen. A synchronous localStorage read, so it is initial state rather
   * than an effect that cascades a render on mount.
   */
  const [decisions, setDecisions] =
    useState<NappletDecision[]>(getNappletDecisions);
  const refreshDecisions = useCallback(
    () => setDecisions(getNappletDecisions()),
    [],
  );
  useEffect(
    () => subscribeNappletDecisions(refreshDecisions),
    [refreshDecisions],
  );

  /* Grouped by d-tag, which is what a launcher row knows about itself. */
  const decisionsByDTag = useMemo(() => {
    const byDTag = new Map<string, NappletDecision[]>();
    for (const decision of decisions) {
      const list = byDTag.get(decision.dTag);
      if (list) list.push(decision);
      else byDTag.set(decision.dTag, [decision]);
    }
    return byDTag;
  }, [decisions]);

  const refreshInstalled = useCallback(
    () => listNapplets().then((rows) => setInstalled(rows.map(fromInstalled))),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    listNapplets().then((rows) => {
      if (!cancelled) setInstalled(rows.map(fromInstalled));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [fetchedAuthors, setFetchedAuthors] = useState<string[] | null>(null);

  // A cached follow list is a pure read, so take it during render rather than
  // setting state on mount.
  const cachedAuthors = useMemo(() => {
    const pubkey = account?.pubkey;
    const event = pubkey
      ? defaultEventStore.getReplaceable(3, pubkey)
      : undefined;
    return event ? readFollows(event) : null;
  }, [account?.pubkey]);

  const authors = cachedAuthors ?? fetchedAuthors;

  // On a cold load the follow list is usually absent, and silently reporting
  // "no contacts" would look like the feature is broken.
  useEffect(() => {
    const pubkey = account?.pubkey;
    if (!pubkey || cachedAuthors) return;
    let cancelled = false;

    selectRelaysForFilter(defaultEventStore, {
      kinds: [3],
      authors: [pubkey],
    })
      .then((selection) =>
        requestEvent(selection.relays, {
          kinds: [3],
          authors: [pubkey],
          limit: 1,
        }),
      )
      .then((event) => {
        if (!cancelled) setFetchedAuthors(event ? readFollows(event) : []);
      })
      .catch(() => {
        if (!cancelled) setFetchedAuthors([]);
      });

    return () => {
      cancelled = true;
    };
  }, [account?.pubkey, cachedAuthors]);

  useEffect(() => {
    if (!authors || authors.length === 0) return;
    let cancelled = false;

    const filter = { kinds: [...NAPPLET_KINDS], authors, limit: 200 };
    selectRelaysForFilter(defaultEventStore, filter)
      .then((selection) => requestEvents(selection.relays, [filter]))
      .then((events) => {
        if (cancelled) return;
        // Newest wins per coordinate: these are replaceable events.
        const newest = new Map<string, NostrEvent>();
        for (const event of events) {
          const coordinate = fromEvent(event).coordinate;
          const prior = newest.get(coordinate);
          if (!prior || prior.created_at < event.created_at) {
            newest.set(coordinate, event);
          }
        }
        setDiscovered([...newest.values()].map(fromEvent));
      })
      .catch((error) => {
        // Not `[]`: "the relays did not answer" and "your contacts publish no
        // napplets" look identical rendered as an empty list, and the first is
        // the one worth acting on.
        if (cancelled) return;
        console.warn("[napplet] discovery failed", error);
        setDiscoveryFailed(true);
        setDiscovered([]);
      });

    return () => {
      cancelled = true;
    };
  }, [authors]);

  const run = useCallback(
    (candidate: Candidate) => {
      const pointer = pointerFromCoordinate(candidate.coordinate);
      if (!pointer) return;
      const command =
        "id" in pointer
          ? `app ${nip19.neventEncode(pointer)}`
          : `app ${nip19.naddrEncode(pointer)}`;
      // Same command either way; the kind decides which window runs it, as it
      // does when the command is typed.
      addWindow(
        isNsiteKind(candidate.kind) ? "nsite" : "app",
        { pointer },
        command,
        undefined,
      );
    },
    [addWindow],
  );

  const match = useCallback(
    (candidate: Candidate) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        candidate.title.toLowerCase().includes(needle) ||
        candidate.identifier.toLowerCase().includes(needle) ||
        (candidate.description ?? "").toLowerCase().includes(needle)
      );
    },
    [query],
  );

  const mine = useMemo(() => installed.filter(match), [installed, match]);
  const theirs = useMemo(() => {
    const own = new Set(installed.map((c) => c.coordinate));
    return (discovered ?? []).filter((c) => match(c) && !own.has(c.coordinate));
  }, [discovered, installed, match]);

  /* Yours first: something the reader has already run is more likely to be
     what they came back for than something a contact published. */
  const all = useMemo(() => [...mine, ...theirs], [mine, theirs]);

  /* One flat list with filters, the way `spells` does it, rather than stacked
     sections. Where an app came from is a property of the app, not a place it
     lives, and two grids of the same card made it look like two kinds. */
  const shown =
    filter === "yours" ? mine : filter === "contacts" ? theirs : all;
  const searching = discovered === null && (authors?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Apps</h2>
          <Badge variant="secondary" className="ml-2">
            {shown.length}/{all.length}
          </Badge>
          {searching && (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps..."
              className="pl-9"
            />
          </div>

          <div className="flex gap-1">
            {(["all", "yours", "contacts"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "All"
                  : value === "yours"
                    ? "Yours"
                    : "Contacts"}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {discoveryFailed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-4 py-2 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          The relays did not answer, so this list may be incomplete.
        </div>
      )}

      {/* A container query, not a viewport one. These windows are tiled: a pane
          can be 300px wide on a large display, and `md:` would call that a
          desktop and lay three columns into it. */}
      <div className="@container flex-1 overflow-y-auto p-4">
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="max-w-md text-center">
              <Boxes className="mx-auto mb-3 size-12 opacity-50" />
              <h3 className="mb-2 text-lg font-semibold">No apps found</h3>
              <p className="mb-4 text-sm">
                {query
                  ? "Try a different search query"
                  : filter === "contacts"
                    ? "Nobody you follow has published one yet"
                    : "Apps you run show up here"}
              </p>
              <p className="text-xs">
                Run one with{" "}
                <code className="font-mono">app &lt;naddr&gt;</code>, or from a
                manifest in any feed
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
            {shown.map((candidate) => (
              <NappletRow
                key={candidate.coordinate}
                candidate={candidate}
                decisions={decisionsByDTag.get(candidate.identifier)}
                onDecisionsChanged={refreshDecisions}
                onRun={() => run(candidate)}
                onPin={
                  candidate.lastRunAt === undefined
                    ? undefined
                    : async () => {
                        await setNappletPinned(
                          candidate.coordinate,
                          !candidate.pinned,
                        );
                        await refreshInstalled();
                      }
                }
                onForget={
                  candidate.lastRunAt === undefined
                    ? undefined
                    : async () => {
                        await forgetNapplet(candidate.coordinate);
                        await refreshInstalled();
                      }
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default NappletsViewer;
