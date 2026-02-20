import { useState, useCallback, useEffect, useMemo } from "react";
import { use$, useEventStore } from "applesauce-react/hooks";
import { EventFactory } from "applesauce-core/event-factory";
import { toast } from "sonner";
import { X, Plus, Loader2, Save, Undo2, CircleDot } from "lucide-react";
import type { NostrEvent } from "nostr-tools";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KindBadge } from "@/components/KindBadge";
import { NIPBadge } from "@/components/NIPBadge";
import { useAccount } from "@/hooks/useAccount";
import { useRelayInfo } from "@/hooks/useRelayInfo";
import { publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";
import { cn } from "@/lib/utils";
import {
  type RelayEntry,
  type RelayMode,
  type RelayListKindConfig,
  parseRelayEntries,
  buildRelayListTags,
  sanitizeRelayInput,
  relayEntriesEqual,
  getRelayMode,
  modeToFlags,
} from "@/lib/relay-list-utils";

// --- Config ---

interface RelayListKindUIConfig extends RelayListKindConfig {
  nip: string;
}

const RELAY_LIST_KINDS: RelayListKindUIConfig[] = [
  {
    kind: 10002,
    name: "Relay List",
    description:
      "Your primary read and write relays. Other clients use this to find your posts and deliver mentions to you.",
    nip: "65",
    tagName: "r",
    hasMarkers: true,
  },
  {
    kind: 10006,
    name: "Blocked Relays",
    description:
      "Relays your client should never connect to. Useful for avoiding spam or untrusted servers.",
    nip: "51",
    tagName: "relay",
    hasMarkers: false,
  },
  {
    kind: 10007,
    name: "Search Relays",
    description:
      "Relays used for search queries. These should support NIP-50 full-text search.",
    nip: "51",
    tagName: "relay",
    hasMarkers: false,
  },
  {
    kind: 10012,
    name: "Favorite Relays",
    description:
      "Relays you find interesting or want to browse. Can be used by clients for relay discovery and recommendations.",
    nip: "51",
    tagName: "relay",
    hasMarkers: false,
  },
  {
    kind: 10050,
    name: "DM Relays",
    description:
      "Relays where you receive direct messages. Senders look up this list to deliver encrypted DMs to you.",
    nip: "17",
    tagName: "relay",
    hasMarkers: false,
  },
];

// --- Components ---

function RelayModeSelect({
  mode,
  onChange,
}: {
  mode: RelayMode;
  onChange: (mode: RelayMode) => void;
}) {
  return (
    <Select value={mode} onValueChange={(v) => onChange(v as RelayMode)}>
      <SelectTrigger className="w-32 h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="readwrite">Read & Write</SelectItem>
        <SelectItem value="read">Read only</SelectItem>
        <SelectItem value="write">Write only</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Display-only relay row for the settings list (no navigation on click) */
function RelaySettingsRow({
  url,
  iconClassname,
}: {
  url: string;
  iconClassname?: string;
}) {
  const relayInfo = useRelayInfo(url);
  const displayUrl = url.replace(/^wss?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
      {relayInfo?.icon && (
        <img
          src={relayInfo.icon}
          alt=""
          className={cn("size-4 flex-shrink-0 rounded-sm", iconClassname)}
        />
      )}
      <span className="text-sm truncate">{displayUrl}</span>
    </div>
  );
}

function RelayEntryRow({
  entry,
  config,
  onRemove,
  onModeChange,
}: {
  entry: RelayEntry;
  config: RelayListKindUIConfig;
  onRemove: () => void;
  onModeChange?: (mode: RelayMode) => void;
}) {
  const currentMode = getRelayMode(entry);

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group">
      <RelaySettingsRow url={entry.url} />
      {config.hasMarkers && onModeChange && (
        <RelayModeSelect mode={currentMode} onChange={onModeChange} />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 flex-shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function AddRelayInput({
  config,
  existingUrls,
  onAdd,
}: {
  config: RelayListKindUIConfig;
  existingUrls: Set<string>;
  onAdd: (entry: RelayEntry) => void;
}) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<RelayMode>("readwrite");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = useCallback(() => {
    setError(null);
    const normalized = sanitizeRelayInput(input);

    if (!normalized) {
      setError("Invalid relay URL");
      return;
    }

    if (existingUrls.has(normalized)) {
      setError("Relay already in list");
      return;
    }

    onAdd({
      url: normalized,
      ...modeToFlags(mode),
    });
    setInput("");
    setError(null);
  }, [input, mode, existingUrls, onAdd]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  return (
    <div className="space-y-1.5 pt-3 border-t border-border/30">
      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="relay.example.com"
          className="h-8 text-xs flex-1"
        />
        {config.hasMarkers && (
          <RelayModeSelect mode={mode} onChange={setMode} />
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={handleAdd}
          disabled={!input.trim()}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RelayListAccordion({
  config,
  entries,
  isDirty,
  onChange,
}: {
  config: RelayListKindUIConfig;
  entries: RelayEntry[];
  isDirty: boolean;
  onChange: (entries: RelayEntry[]) => void;
}) {
  const existingUrls = useMemo(
    () => new Set(entries.map((e) => e.url)),
    [entries],
  );

  const handleRemove = useCallback(
    (url: string) => {
      onChange(entries.filter((e) => e.url !== url));
    },
    [entries, onChange],
  );

  const handleModeChange = useCallback(
    (url: string, mode: RelayMode) => {
      onChange(
        entries.map((e) =>
          e.url === url ? { ...e, ...modeToFlags(mode) } : e,
        ),
      );
    },
    [entries, onChange],
  );

  const handleAdd = useCallback(
    (entry: RelayEntry) => {
      onChange([...entries, entry]);
    },
    [entries, onChange],
  );

  return (
    <AccordionItem value={`kind-${config.kind}`}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <KindBadge
            kind={config.kind}
            variant="full"
            className="text-sm"
            iconClassname="text-muted-foreground"
          />
          {entries.length > 0 && (
            <span className="text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 tabular-nums">
              {entries.length}
            </span>
          )}
          {isDirty && (
            <CircleDot className="size-3 text-primary flex-shrink-0" />
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-xs text-muted-foreground flex-1">
            {config.description}
          </p>
          <NIPBadge
            nipNumber={config.nip}
            showName={false}
            className="text-xs flex-shrink-0"
          />
        </div>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic py-2">
            No relays configured
          </p>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry) => (
              <RelayEntryRow
                key={entry.url}
                entry={entry}
                config={config}
                onRemove={() => handleRemove(entry.url)}
                onModeChange={
                  config.hasMarkers
                    ? (mode) => handleModeChange(entry.url, mode)
                    : undefined
                }
              />
            ))}
          </div>
        )}
        <AddRelayInput
          config={config}
          existingUrls={existingUrls}
          onAdd={handleAdd}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

// --- Main Component ---

export function RelayListsSettings() {
  const { pubkey, canSign } = useAccount();
  const eventStore = useEventStore();
  const [saving, setSaving] = useState(false);

  // Read current events from EventStore for each kind
  const event10002 = use$(
    () => (pubkey ? eventStore.replaceable(10002, pubkey, "") : undefined),
    [pubkey],
  );
  const event10006 = use$(
    () => (pubkey ? eventStore.replaceable(10006, pubkey, "") : undefined),
    [pubkey],
  );
  const event10007 = use$(
    () => (pubkey ? eventStore.replaceable(10007, pubkey, "") : undefined),
    [pubkey],
  );
  const event10012 = use$(
    () => (pubkey ? eventStore.replaceable(10012, pubkey, "") : undefined),
    [pubkey],
  );
  const event10050 = use$(
    () => (pubkey ? eventStore.replaceable(10050, pubkey, "") : undefined),
    [pubkey],
  );

  const eventsMap: Record<number, NostrEvent | undefined> = useMemo(
    () => ({
      10002: event10002,
      10006: event10006,
      10007: event10007,
      10012: event10012,
      10050: event10050,
    }),
    [event10002, event10006, event10007, event10012, event10050],
  );

  // Local draft state: kind -> entries
  const [drafts, setDrafts] = useState<Record<number, RelayEntry[]>>({});
  // Track which event IDs we've initialized from (to re-sync when events update)
  const [syncedEventIds, setSyncedEventIds] = useState<
    Record<number, string | undefined>
  >({});

  // Sync drafts from EventStore events when they change
  useEffect(() => {
    let changed = false;
    const newDrafts = { ...drafts };
    const newSyncedIds = { ...syncedEventIds };

    for (const config of RELAY_LIST_KINDS) {
      const event = eventsMap[config.kind];
      const eventId = event?.id;

      if (eventId !== syncedEventIds[config.kind]) {
        newDrafts[config.kind] = parseRelayEntries(event, config);
        newSyncedIds[config.kind] = eventId;
        changed = true;
      }
    }

    if (changed) {
      setDrafts(newDrafts);
      setSyncedEventIds(newSyncedIds);
    }
  }, [eventsMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-kind dirty check
  const dirtyKinds = useMemo(() => {
    const dirty = new Set<number>();
    for (const config of RELAY_LIST_KINDS) {
      const original = parseRelayEntries(eventsMap[config.kind], config);
      const draft = drafts[config.kind] ?? [];
      if (!relayEntriesEqual(original, draft)) {
        dirty.add(config.kind);
      }
    }
    return dirty;
  }, [eventsMap, drafts]);

  const hasChanges = dirtyKinds.size > 0;

  const handleChange = useCallback((kind: number, entries: RelayEntry[]) => {
    setDrafts((prev) => ({ ...prev, [kind]: entries }));
  }, []);

  const handleDiscard = useCallback(() => {
    const restored: Record<number, RelayEntry[]> = {};
    for (const config of RELAY_LIST_KINDS) {
      restored[config.kind] = parseRelayEntries(eventsMap[config.kind], config);
    }
    setDrafts(restored);
  }, [eventsMap]);

  const handleSave = useCallback(async () => {
    if (!canSign || saving) return;

    const account = accountManager.active;
    if (!account?.signer) {
      toast.error("No signer available");
      return;
    }

    setSaving(true);

    try {
      const factory = new EventFactory({ signer: account.signer });

      for (const config of RELAY_LIST_KINDS) {
        if (!dirtyKinds.has(config.kind)) continue;

        const draft = drafts[config.kind] ?? [];
        const tags = buildRelayListTags(draft, config);
        const built = await factory.build({
          kind: config.kind,
          content: "",
          tags,
        });
        const signed = await factory.sign(built);
        await publishEvent(signed);
      }

      toast.success("Relay lists updated");
    } catch (err) {
      console.error("Failed to publish relay lists:", err);
      toast.error(
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  }, [canSign, saving, drafts, dirtyKinds]);

  if (!pubkey) {
    return (
      <div>
        <h3 className="text-lg font-semibold mb-1">Relays</h3>
        <p className="text-sm text-muted-foreground">
          Log in to manage your relay lists.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1">Relays</h3>
        <p className="text-sm text-muted-foreground">
          Manage your Nostr relay lists
        </p>
      </div>

      <Accordion type="multiple" className="w-full">
        {RELAY_LIST_KINDS.map((config) => (
          <RelayListAccordion
            key={config.kind}
            config={config}
            entries={drafts[config.kind] ?? []}
            isDirty={dirtyKinds.has(config.kind)}
            onChange={(entries) => handleChange(config.kind, entries)}
          />
        ))}
      </Accordion>

      {!canSign && (
        <p className="text-xs text-muted-foreground">
          Read-only account. Log in with a signer to edit relay lists.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {hasChanges && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDiscard}
            disabled={saving}
            className="gap-1.5 text-muted-foreground"
          >
            <Undo2 className="size-3.5" />
            Discard
          </Button>
        )}
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving || !canSign}
          className="gap-2"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
