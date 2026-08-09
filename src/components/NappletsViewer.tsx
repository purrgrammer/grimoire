import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Pin, Play, Search, Shapes, Trash2, Users } from "lucide-react";
import { nip19 } from "nostr-tools";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  nappletCoordinate,
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
}: {
  candidate: Candidate;
  onRun: () => void;
  onPin?: () => void;
  onForget?: () => void;
}) {
  return (
    <div className="group flex items-start gap-3 rounded border border-border/40 p-3 hover:bg-muted/30">
      <Boxes className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {candidate.title}
          </span>
          {candidate.pinned && (
            <Pin className="size-3 shrink-0 text-muted-foreground" />
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          <UserName pubkey={candidate.pubkey} />
        </div>
        {candidate.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {candidate.description}
          </p>
        )}
        {candidate.requires.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-0.5">
            {candidate.requires.map((nap) => (
              <Label key={nap}>{nap}</Label>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onPin && (
          <button
            className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            title={candidate.pinned ? "Unpin" : "Pin"}
            onClick={onPin}
          >
            <Pin className="size-3.5" />
          </button>
        )}
        {onForget && (
          <button
            className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            title="Remove from your napplets"
            onClick={onForget}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
        <Button size="sm" className="h-7" onClick={onRun}>
          <Play className="size-3.5" />
          Run
        </Button>
      </div>
    </div>
  );
}

/**
 * One archetype and the napplets competing for it.
 *
 * The point of showing this is that `app <archetype>` refuses to guess: with two
 * handlers and no default the command errors, and the only place the user can
 * settle it is here. So the row states what the command would do, not just what
 * is installed.
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
    <div className="flex items-start gap-3 rounded border border-border/40 p-3">
      <Shapes className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm">app {role.archetype}</code>
          {usage ? (
            <span className="truncate text-xs text-muted-foreground">
              → {role.resolved?.title} ·{" "}
              <code className="font-mono">{usage}</code>
            </span>
          ) : role.resolved ? (
            <span className="truncate text-xs text-muted-foreground">
              → {role.resolved.title}
              {role.defaultDTag && " (default)"}
            </span>
          ) : (
            <span className="text-xs text-amber-500">
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
                  className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                    isDefault
                      ? "border-primary text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
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
          className="h-7 shrink-0"
          onClick={() => onRun(role.resolved!)}
        >
          <Play className="size-3.5" />
          Run
        </Button>
      )}
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
      .catch(() => {
        if (!cancelled) setDiscovered([]);
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
      addWindow("app", { pointer }, command, undefined);
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search napplets"
          className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground">
            Yours ({mine.length})
          </h2>
          {mine.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Napplets you run show up here. Try one from below, or{" "}
              <code className="font-mono">app &lt;naddr&gt;</code>.
            </p>
          ) : (
            mine.map((candidate) => (
              <NappletRow
                key={candidate.coordinate}
                candidate={candidate}
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
            ))
          )}
        </section>

        {roles.length > 0 && (
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Shapes className="size-3.5" />
              Roles ({roles.length})
            </h2>
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
                  openBuiltinArchetype(role.archetype, "open").catch((error) =>
                    toast.error(
                      error instanceof Error ? error.message : String(error),
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
          </section>
        )}

        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Users className="size-3.5" />
            From your contacts ({theirs.length})
            {discovered === null && (authors?.length ?? 0) > 0 && (
              <span className="font-normal">· searching…</span>
            )}
          </h2>
          {!account?.pubkey ? (
            <p className="text-xs text-muted-foreground">
              Sign in to see what the people you follow publish.
            </p>
          ) : (
            theirs.map((candidate) => (
              <NappletRow
                key={candidate.coordinate}
                candidate={candidate}
                onRun={() => run(candidate)}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

export default NappletsViewer;

/** Re-exported so the launcher and the viewer agree on identity. */
export { nappletCoordinate };
