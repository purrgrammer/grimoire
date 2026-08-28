import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  BookOpenIcon,
  BracesIcon,
  FileTextIcon,
  WandSparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { CommandChips } from "./CommandChips";
import { DraftEvent } from "./DraftEvent";
import { ReplyCodeBlock } from "./ReplyCodeBlock";

import { KindBadge } from "@/components/KindBadge";
import { NIPBadge } from "@/components/NIPBadge";
import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { useAddWindow } from "@/core/state";
import { canonicalId } from "@/lib/ai-registry";
import { sanitizeDraft, type EventDraft } from "@/lib/ai-draft";
import { cn } from "@/lib/utils";

import type { ToolRun } from "@/types/tool-part";

/** Most events one tool row draws. The model may read more than a pane can. */
const MAX_RENDERED = 40;

/**
 * A run's canonical tool id.
 *
 * Runs are stamped with the name the provider used, and conversations persist —
 * so a transcript from before the registry says `query_nostr` and one from after
 * says `nostr_req`. Both mean the same tool, and the registry is what knows it.
 */
function idOf(run: ToolRun): string {
  return canonicalId(run.name);
}

/**
 * Commands a `grimoire.command` call offered, and why.
 *
 * The rows are the point: nothing ran, and the user pressing one is the whole
 * mechanism. Rendered from the output rather than the input, because the tool
 * already dropped the lines grimoire does not have.
 */
function proposalOf(
  run: ToolRun,
): { commands: string[]; reason?: string } | undefined {
  if (idOf(run) !== "grimoire.command" || run.state !== "output-available") {
    return undefined;
  }
  const output = run.output as
    { offered?: unknown; reason?: unknown } | undefined;
  const commands = Array.isArray(output?.offered)
    ? output.offered.filter((line): line is string => typeof line === "string")
    : [];
  if (commands.length === 0) return undefined;
  return {
    commands,
    ...(typeof output?.reason === "string" ? { reason: output.reason } : {}),
  };
}

/**
 * The event a `nostr.draft` call drafted.
 *
 * Re-validated here rather than trusted: this render is the thing with a
 * signing button on it, and the output travelled through a stored conversation
 * to reach it.
 */
function draftOf(run: ToolRun): EventDraft | undefined {
  if (idOf(run) !== "nostr.draft" || run.state !== "output-available") {
    return undefined;
  }
  const draft = sanitizeDraft(run.output);
  return "error" in draft ? undefined : draft;
}

/**
 * Event ids a `nostr.req` call returned.
 *
 * `requestEvents` puts everything it fetches in the EventStore, so the ids are
 * enough — the feed renders from the store rather than from a JSON copy of it,
 * which is also why the result does not need to carry signatures.
 */
function feedOf(run: ToolRun): string[] | undefined {
  if (idOf(run) !== "nostr.req" || run.state !== "output-available") {
    return undefined;
  }
  const events = (run.output as { events?: unknown })?.events;
  if (!Array.isArray(events)) return undefined;
  const ids = events
    .map((event) => (event as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? ids : undefined;
}

/** The command an `open_window` call ran, if it looks like one. */
function commandOf(run: ToolRun): string | undefined {
  if (idOf(run) !== "grimoire.window") return undefined;
  const command = (run.input as { command?: unknown })?.command;
  return typeof command === "string" ? command : undefined;
}

/** What a `resolve` call turned a bech32 into, as a pointer to render. */
function resolvedOf(
  run: ToolRun,
): { pubkey: string } | { id: string } | undefined {
  if (idOf(run) !== "nostr.resolve" || run.state !== "output-available") {
    return undefined;
  }
  const output = run.output as
    { type?: unknown; pubkey?: unknown; event?: { id?: unknown } } | undefined;
  if (output?.type === "profile" && typeof output.pubkey === "string") {
    return { pubkey: output.pubkey };
  }
  if (output?.type === "event" && typeof output.event?.id === "string") {
    return { id: output.event.id };
  }
  return undefined;
}

/**
 * The spells a `list_spells` call read, by alias.
 *
 * A spell's command is a `req`, and the row shows it as one: the command chips
 * run it, which is the same thing the user would do with the answer.
 */
function spellsOf(
  run: ToolRun,
): { names: string[]; commands: string[] } | undefined {
  if (idOf(run) !== "grimoire.spells" || run.state !== "output-available") {
    return undefined;
  }
  const output = run.output as
    | {
        spells?: { alias?: unknown; name?: unknown; command?: unknown }[];
        alias?: unknown;
        name?: unknown;
        command?: unknown;
        error?: unknown;
      }
    | undefined;
  if (!output || typeof output.error === "string") return undefined;

  const rows = output.spells ?? [output];
  const names = rows
    .map((row) =>
      typeof row.alias === "string"
        ? row.alias
        : typeof row.name === "string"
          ? row.name
          : undefined,
    )
    .filter((name): name is string => name !== undefined);
  const commands = rows
    .map((row) => (typeof row.command === "string" ? row.command : undefined))
    .filter((command): command is string => command !== undefined);
  return { names, commands };
}

interface Lookup {
  nip?: string;
  kind?: number;
  command?: string;
  /** What could not be read, when the answer was a refusal. */
  missing?: string;
}

/**
 * What a `lookup_spec` call read.
 *
 * From the output, not the input: the tool normalises a nip id and follows a
 * kind to the NIP that defines it, so the result names what was actually read.
 */
function lookupOf(run: ToolRun): Lookup | undefined {
  if (idOf(run) !== "grimoire.help" || run.state !== "output-available") {
    return undefined;
  }
  const output = run.output as
    | {
        nip?: { id?: unknown; error?: unknown };
        kind?: { kind?: unknown; known?: unknown };
        command?: { name?: unknown; error?: unknown };
        error?: unknown;
      }
    | undefined;
  if (!output) return undefined;

  const lookup: Lookup = {};
  if (typeof output.nip?.id === "string") lookup.nip = output.nip.id;
  if (typeof output.kind?.kind === "number") lookup.kind = output.kind.kind;
  if (typeof output.command?.name === "string") {
    lookup.command = output.command.name;
  }

  const missing = [
    typeof output.error === "string" ? output.error : undefined,
    typeof output.nip?.error === "string" ? output.nip.error : undefined,
    typeof output.command?.error === "string"
      ? output.command.error
      : undefined,
    output.kind?.known === false ? "Not in the kind registry." : undefined,
  ].filter(Boolean)[0];
  if (missing) lookup.missing = missing;

  return Object.keys(lookup).length > 0 ? lookup : undefined;
}

/**
 * The strip every tool result wears: an icon, the tool's own name, then
 * whatever that tool has to show on the right. Shared so `grimoire.help` and
 * `nostr.req` line up — they sit next to each other in one turn.
 */
function ToolHeading({
  children,
  className,
  icon: Icon,
  name,
}: {
  children?: ReactNode;
  className?: string;
  icon: LucideIcon;
  name: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="size-3" />
        <span className="font-mono">{name}</span>
      </span>
      {children}
    </div>
  );
}

/**
 * What Hex read, as the things grimoire already renders: a NIP badge, a kind
 * badge, a command that opens its manual page. Each is clickable, so the answer
 * is one click from the source it came from — which is the point of a lookup
 * whose whole job was to avoid recall.
 */
function ToolLookup({ lookup, name }: { lookup: Lookup; name: string }) {
  const addWindow = useAddWindow();

  return (
    <ToolHeading
      className="my-2 rounded border border-border"
      icon={BookOpenIcon}
      name={name}
    >
      {lookup.nip && <NIPBadge className="text-xs" nipNumber={lookup.nip} />}
      {lookup.kind !== undefined && (
        <KindBadge
          className="text-xs"
          clickable
          kind={lookup.kind}
          variant="full"
        />
      )}
      {lookup.command && (
        <button
          className="flex items-center gap-1 font-mono text-foreground hover:underline"
          onClick={() =>
            addWindow(
              "man",
              { cmd: lookup.command },
              `man ${lookup.command}`,
              `MAN ${lookup.command?.toUpperCase()}`,
            )
          }
          title={`Open the manual page for ${lookup.command}`}
          type="button"
        >
          {lookup.command}
          <span className="text-muted-foreground">(1)</span>
        </button>
      )}
      {lookup.missing && (
        <span className="italic">{lookup.missing.toLowerCase()}</span>
      )}
    </ToolHeading>
  );
}

/** The REQ a query actually sent, aliases expanded — not what was asked for. */
function reqOf(run: ToolRun): string {
  const output = run.output as
    { filter?: unknown; relays?: unknown } | undefined;
  return JSON.stringify(
    {
      filter: output?.filter ?? run.input,
      ...(output?.relays ? { relays: output.relays } : {}),
    },
    null,
    2,
  );
}

/**
 * Events a tool fetched, in the shape `req` shows them: a status strip over a
 * divided list of rendered events. Rendering from the EventStore means each row
 * is the same component the feed uses, so a note looks like a note here too.
 *
 * The filter is behind a toggle rather than summarised in words: a full NIP-01
 * filter does not fit in a strip, and the JSON is the thing worth reading —
 * it is what the relays saw, `$contacts` already expanded.
 */
function ToolFeed({ ids, run }: { ids: string[]; run: ToolRun }) {
  const [showReq, setShowReq] = useState(false);

  return (
    <div className="my-2 overflow-hidden rounded border border-border">
      <ToolHeading
        className="border-b border-border"
        icon={WrenchIcon}
        name={idOf(run)}
      >
        <button
          className={cn(
            "ml-auto flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground",
            showReq && "bg-muted text-foreground",
          )}
          onClick={() => setShowReq((open) => !open)}
          title={showReq ? "Hide the filter" : "Show the filter"}
          type="button"
        >
          <BracesIcon className="size-3" />
        </button>
        <span className="flex items-center gap-1">
          <FileTextIcon className="size-3" />
          {ids.length}
        </span>
      </ToolHeading>
      {showReq && (
        <div className="border-b border-border bg-muted/10 p-2">
          <ReplyCodeBlock code={reqOf(run)} language="json" />
        </div>
      )}
      {/* Scrolls inside itself: a dozen events, each rendered whole and some
          quoting their parent, is longer than the conversation that asked for
          them — the answer was unreachable below it. And only the first
          `MAX_RENDERED` are drawn: the model may ask for hundreds, which it is
          welcome to read, but hundreds of live event renderers in a chat pane is
          a frozen tab. The count is stated rather than silently dropped. */}
      <div className="max-h-80 divide-y divide-border/50 overflow-y-auto">
        {ids.slice(0, MAX_RENDERED).map((id) => (
          <EmbeddedEvent className="" eventPointer={{ id }} key={id} />
        ))}
        {ids.length > MAX_RENDERED && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {ids.length - MAX_RENDERED} more read but not shown.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Tool calls the page executed for a turn, collapsed.
 *
 * Shown because the model asking for data is a thing the user paid for and
 * should be able to audit: which tool, with what arguments, and what came back.
 */
export function ToolRuns({ runs }: { runs: ToolRun[] }) {
  if (runs.length === 0) return null;

  return (
    <div className="my-2 space-y-3">
      {runs.map((run, index) => {
        // A completed `open_window` is just the command it ran: the Tool
        // wrapper would collapse the one thing worth seeing behind a header,
        // and the row itself re-runs it. Failures keep the wrapper, because
        // then the error is the point.
        const command = commandOf(run);
        if (command && run.state === "output-available") {
          return <CommandChips block={command} key={`${run.name}-${index}`} />;
        }

        // What Hex offered renders as rows the user presses — the same
        // component a fenced proposal uses, because it is the same offer made
        // through a tool instead of a fence.
        const proposal = proposalOf(run);
        if (proposal) {
          return (
            <div key={`${run.name}-${index}`}>
              {proposal.reason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {proposal.reason}
                </p>
              )}
              <CommandChips block={proposal.commands.join("\n")} />
            </div>
          );
        }

        // A drafted event renders as the event it would be, with the button
        // that signs it. Nothing here has been signed.
        const draft = draftOf(run);
        if (draft) {
          return <DraftEvent draft={draft} key={`${run.name}-${index}`} />;
        }

        // What Hex fetched renders as a feed, the way the same events render
        // anywhere else in grimoire. A JSON dump of them says less and is long.
        const feed = feedOf(run);
        if (feed) {
          return <ToolFeed ids={feed} key={`${run.name}-${index}`} run={run} />;
        }

        // What Hex read renders as what it read: badges that open the NIP, the
        // kind, or the manual page. The NIP text itself is thousands of words
        // and is already in the answer.
        // What a bech32 turned out to be, rendered as itself: a person through
        // the kind 0 renderer, an event through the feed's. The JSON says the
        // same thing in a form nobody reads.
        const resolved = resolvedOf(run);
        if (resolved) {
          return (
            <div className="my-2" key={`${run.name}-${index}`}>
              <ToolHeading
                className="rounded-t border border-b-0 border-border"
                icon={BookOpenIcon}
                name={idOf(run)}
              />
              <EmbeddedEvent
                className="overflow-hidden rounded-b border border-border"
                {...("pubkey" in resolved
                  ? {
                      addressPointer: {
                        kind: 0,
                        pubkey: resolved.pubkey,
                        identifier: "",
                      },
                    }
                  : { eventPointer: { id: resolved.id } })}
              />
            </div>
          );
        }

        // What was saved, as the commands they are: a spell is a `req` someone
        // kept, and a row that runs it says more than its alias does.
        const spells = spellsOf(run);
        if (spells) {
          return (
            // Heading, then the commands as rows — same shape as a proposal,
            // and no second border boxing them in.
            <div className="my-2" key={`${run.name}-${index}`}>
              <ToolHeading
                className="rounded border border-border"
                icon={WandSparklesIcon}
                name={idOf(run)}
              >
                {spells.names.length > 0 ? (
                  <span className="font-mono text-foreground">
                    {spells.names.join(", ")}
                  </span>
                ) : (
                  <span className="italic">nothing saved</span>
                )}
              </ToolHeading>
              {spells.commands.length > 0 && (
                <CommandChips block={spells.commands.join("\n")} />
              )}
            </div>
          );
        }

        const lookup = lookupOf(run);
        if (lookup) {
          return (
            <ToolLookup
              key={`${run.name}-${index}`}
              lookup={lookup}
              name={idOf(run)}
            />
          );
        }

        return (
          <Tool className="mb-0" key={`${run.name}-${index}`}>
            <ToolHeader state={run.state} type={`tool-${idOf(run)}`} />
            <ToolContent>
              {/* A command Hex ran renders as a command, the way the palette and
                its proposals do — the JSON of `{command: "..."}` says less than
                the row does, and the row re-runs it. */}
              {command ? (
                <CommandChips block={command} />
              ) : (
                <ToolInput input={run.input} />
              )}
              <ToolOutput errorText={run.errorText} output={run.output} />
            </ToolContent>
          </Tool>
        );
      })}
    </div>
  );
}
