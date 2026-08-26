import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  Loader2,
  Pin,
  Play,
  Search,
  Shapes,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { nip19 } from "nostr-tools";
import { toast } from "sonner";

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
import { cn } from "@/lib/utils";
import { useAddWindow } from "@/core/state";
import { useAccount } from "@/hooks/useAccount";
import {
  listNapplets,
  setNappletPinned,
  forgetNapplet,
  pointerFromCoordinate,
  type InstalledNapplet,
} from "@/services/napplet-library";
import {
  listArchetypeRoles,
  type ArchetypeCandidate,
  type ArchetypeRole,
} from "@/services/napplet-archetype";
import {
  setDefaultHandler,
  clearDefaultHandler,
} from "@/services/napplet-intent-defaults";
import {
  openBuiltinArchetype,
  builtinNeedsTarget,
  builtinUsage,
} from "@/services/napplet-builtins";
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
 * One archetype and the napplets competing for it.
 *
 * The point of showing this is that `app <archetype>` refuses to guess: with two
 * handlers and no default the command errors, and the only place the user can
 * settle it is here. So the row states what the command would do, not just what
 * is installed.
 *
 * A row in a shared panel rather than a card of its own: a role is a setting,
 * not a launchable thing, and the grid above already means "click to run".
 */
function RoleRow({
  role,
  onRun,
  onChoose,
}: {
  role: ArchetypeRole;
  onRun: (candidate: ArchetypeCandidate) => void;
  onChoose: (dTag: string | null) => void;
}) {
  const contested = role.candidates.length > 1;
  // `app note` alone cannot open anything — say what it wants instead of
  // offering a button that only ever produces an error.
  const usage =
    role.resolved?.kind === "builtin" && builtinNeedsTarget(role.archetype)
      ? builtinUsage(role.archetype)
      : undefined;

  return (
    <div className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
      <Shapes className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Wraps rather than truncates: at a narrow pane the archetype is the
            information, and the resolved title is what may be cut. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            app {role.archetype}
          </code>
          {usage ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              → {role.resolved?.title} ·{" "}
              <code className="font-mono">{usage}</code>
            </span>
          ) : role.resolved ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">→ {role.resolved.title}</span>
              {role.defaultDTag && <Label>default</Label>}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warning">
              <TriangleAlert className="size-3 shrink-0" />
              {role.candidates.filter((c) => c.kind === "napplet").length}{" "}
              napplets · pick one
            </span>
          )}
        </div>
        {contested && (
          <div className="flex flex-wrap items-center gap-1">
            {role.candidates.map((candidate) => {
              const isDefault = role.defaultDTag === candidate.dTag;
              return (
                <button
                  key={candidate.dTag}
                  type="button"
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isDefault
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                  title={
                    isDefault
                      ? "Clear this default"
                      : `Make "${candidate.title}" the default`
                  }
                  onClick={() => onChoose(isDefault ? null : candidate.dTag)}
                >
                  {candidate.kind === "builtin" ? "grimoire" : candidate.dTag}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {role.resolved && !usage && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onRun(role.resolved!)}
        >
          <Play className="size-3.5" />
          Run
        </Button>
      )}
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  /** Status that belongs next to the count — "searching…", a warning. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <span className="text-xs tabular-nums text-muted-foreground/60">
        {count}
      </span>
      {children}
    </div>
  );
}

/** A section with nothing in it still needs to say why. */
function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
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

  const [roles, setRoles] = useState<ArchetypeRole[]>([]);
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
    () =>
      Promise.all([
        listNapplets().then((rows) => setInstalled(rows.map(fromInstalled))),
        // Roles are derived from the same rows, so they can never be staler
        // than the list they describe.
        listArchetypeRoles().then(setRoles),
      ]).then(() => undefined),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    listNapplets().then((rows) => {
      if (!cancelled) setInstalled(rows.map(fromInstalled));
    });
    listArchetypeRoles().then((next) => {
      if (!cancelled) setRoles(next);
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

  /* Four different facts read as one empty list otherwise: still searching, a
     relay that never answered, a search that filtered everything out, and an
     account that follows nobody. */
  const contactsEmpty =
    discovered === null || discoveryFailed ? null : query.trim() ? (
      <>
        Nothing your contacts publish matches{" "}
        <span className="font-mono text-foreground">{query.trim()}</span>.
      </>
    ) : (authors?.length ?? 0) === 0 ? (
      "You do not follow anyone yet, so there is nothing to discover."
    ) : (
      "None of the people you follow have published a napplet."
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header, laid out the way `spells` and `spellbooks` lay theirs out:
          icon, title, a count, then the search on its own row. Three windows
          that list things the reader owns should not each invent a shape. */}
      <div className="flex-shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Boxes className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Apps</h2>
          <Badge variant="secondary" className="ml-2">
            {mine.length + theirs.length}
          </Badge>
          {discovered === null && (authors?.length ?? 0) > 0 && (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps..."
            className="pl-9"
          />
        </div>
      </div>

      {/* A container query, not a viewport one. These windows are tiled: a
          pane can be 300px wide on a large display, and `md:` would call that a
          desktop and lay three columns into it — which is exactly what it did,
          truncating every title to "KoboldA…". */}
      <div className="@container flex-1 space-y-8 overflow-y-auto p-4">
        <section className="space-y-3">
          <SectionHeading icon={Boxes} title="Yours" count={mine.length} />
          {mine.length === 0 ? (
            <EmptyPanel>
              {installed.length > 0 && query.trim() ? (
                <>
                  No app you have run matches{" "}
                  <span className="font-mono text-foreground">
                    {query.trim()}
                  </span>
                  .
                </>
              ) : (
                <>
                  Napplets you run show up here. Try one from below, or{" "}
                  <code className="font-mono">app &lt;naddr&gt;</code>.
                </>
              )}
            </EmptyPanel>
          ) : (
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
              {mine.map((candidate) => (
                <NappletRow
                  key={candidate.coordinate}
                  candidate={candidate}
                  decisions={decisionsByDTag.get(candidate.identifier)}
                  onDecisionsChanged={refreshDecisions}
                  onRun={() => run(candidate)}
                  onPin={async () => {
                    await setNappletPinned(
                      candidate.coordinate,
                      !candidate.pinned,
                    );
                    await refreshInstalled();
                  }}
                  onForget={async () => {
                    await forgetNapplet(candidate.coordinate);
                    await refreshInstalled();
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {roles.length > 0 && (
          <section className="space-y-3">
            <div className="space-y-1">
              <SectionHeading
                icon={Shapes}
                title="Roles"
                count={roles.length}
              />
              <p className="text-xs text-muted-foreground/70">
                Which app answers{" "}
                <code className="font-mono">app &lt;role&gt;</code>. With more
                than one candidate the command refuses to guess, so pick the
                default here.
              </p>
            </div>
            <Card className="divide-y divide-border/60 overflow-hidden">
              {roles.map((role) => (
                <RoleRow
                  key={role.archetype}
                  role={role}
                  onRun={(candidate) => {
                    // The command string records the role, not the resolved
                    // napplet: re-running it later should honour whatever the
                    // default is then. The props still pin this exact napplet, so
                    // a restored window is not silently a different one.
                    if (candidate.kind === "napplet") {
                      addWindow(
                        "app",
                        { pointer: candidate.pointer },
                        `app ${role.archetype}`,
                        undefined,
                      );
                      return;
                    }
                    openBuiltinArchetype(role.archetype, "open").catch(
                      (error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        ),
                    );
                  }}
                  onChoose={async (dTag) => {
                    if (dTag) setDefaultHandler(role.archetype, dTag);
                    else clearDefaultHandler(role.archetype);
                    await refreshInstalled();
                  }}
                />
              ))}
            </Card>
          </section>
        )}

        <section className="space-y-3">
          <SectionHeading
            icon={Users}
            title="From your contacts"
            count={theirs.length}
          >
            {discovered === null && (authors?.length ?? 0) > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                searching…
              </span>
            )}
          </SectionHeading>

          {/* A partial answer is worth saying out loud: the list below is not
              "what your contacts publish", it is what one relay admitted to. */}
          {discoveryFailed && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span>
                The relays did not answer — this list may be incomplete.
              </span>
            </div>
          )}

          {!account?.pubkey ? (
            <EmptyPanel>
              Sign in to see what the people you follow publish.
            </EmptyPanel>
          ) : theirs.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
              {theirs.map((candidate) => (
                <NappletRow
                  key={candidate.coordinate}
                  candidate={candidate}
                  onRun={() => run(candidate)}
                />
              ))}
            </div>
          ) : contactsEmpty ? (
            <EmptyPanel>{contactsEmpty}</EmptyPanel>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default NappletsViewer;
