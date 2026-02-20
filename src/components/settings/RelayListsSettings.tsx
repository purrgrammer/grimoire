import { useState, useCallback, useEffect, useMemo } from "react";
import { use$, useEventStore } from "applesauce-react/hooks";
import { EventFactory } from "applesauce-core/event-factory";
import { toast } from "sonner";
import {
  Radio,
  ShieldBan,
  Search,
  Mail,
  X,
  Plus,
  Loader2,
  Save,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { RelayLink } from "@/components/nostr/RelayLink";
import { useAccount } from "@/hooks/useAccount";
import { normalizeRelayURL, isValidRelayURL } from "@/lib/relay-url";
import { publishEvent } from "@/services/hub";
import accountManager from "@/services/accounts";

// --- Types ---

interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

type RelayMode = "readwrite" | "read" | "write";

interface RelayListKindConfig {
  kind: number;
  name: string;
  description: string;
  icon: LucideIcon;
  /** Tag name used in the event: "r" for NIP-65, "relay" for NIP-51 */
  tagName: "r" | "relay";
  /** Whether read/write markers are supported (only kind 10002) */
  hasMarkers: boolean;
}

const RELAY_LIST_KINDS: RelayListKindConfig[] = [
  {
    kind: 10002,
    name: "Relay List",
    description: "Read & write relays (NIP-65)",
    icon: Radio,
    tagName: "r",
    hasMarkers: true,
  },
  {
    kind: 10006,
    name: "Blocked Relays",
    description: "Relays to never connect to",
    icon: ShieldBan,
    tagName: "relay",
    hasMarkers: false,
  },
  {
    kind: 10007,
    name: "Search Relays",
    description: "Relays for search queries",
    icon: Search,
    tagName: "relay",
    hasMarkers: false,
  },
  {
    kind: 10050,
    name: "DM Relays",
    description: "Relays for receiving direct messages",
    icon: Mail,
    tagName: "relay",
    hasMarkers: false,
  },
];

// --- Helpers ---

/** Parse relay entries from a Nostr event based on the kind config */
function parseRelayEntries(
  event: NostrEvent | undefined,
  config: RelayListKindConfig,
): RelayEntry[] {
  if (!event) return [];

  const entries: RelayEntry[] = [];
  const seenUrls = new Set<string>();

  for (const tag of event.tags) {
    if (tag[0] === config.tagName && tag[1]) {
      try {
        const url = normalizeRelayURL(tag[1]);
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        if (config.hasMarkers) {
          const marker = tag[2];
          entries.push({
            url,
            read: !marker || marker === "read",
            write: !marker || marker === "write",
          });
        } else {
          entries.push({ url, read: true, write: true });
        }
      } catch {
        // Skip invalid URLs
      }
    }
  }

  return entries;
}

/** Build event tags from relay entries */
function buildTags(
  entries: RelayEntry[],
  config: RelayListKindConfig,
): string[][] {
  return entries.map((entry) => {
    if (config.tagName === "r") {
      if (entry.read && entry.write) return ["r", entry.url];
      if (entry.read) return ["r", entry.url, "read"];
      return ["r", entry.url, "write"];
    }
    return ["relay", entry.url];
  });
}

/** Sanitize and normalize user input into a valid relay URL */
function sanitizeRelayInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Add wss:// scheme if missing
  let url = trimmed;
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = `wss://${url}`;
  }

  try {
    const normalized = normalizeRelayURL(url);
    if (!isValidRelayURL(normalized)) return null;
    return normalized;
  } catch {
    return null;
  }
}

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

function RelayEntryRow({
  entry,
  config,
  onRemove,
  onModeChange,
}: {
  entry: RelayEntry;
  config: RelayListKindConfig;
  onRemove: () => void;
  onModeChange?: (mode: RelayMode) => void;
}) {
  const currentMode: RelayMode =
    entry.read && entry.write ? "readwrite" : entry.read ? "read" : "write";

  return (
    <div className="flex items-center gap-2 py-1 group">
      <div className="flex-1 min-w-0">
        <RelayLink
          url={entry.url}
          read={config.hasMarkers ? entry.read : false}
          write={config.hasMarkers ? entry.write : false}
          showInboxOutbox={config.hasMarkers}
          className="py-0.5"
          iconClassname="size-4"
          urlClassname="underline decoration-dotted"
        />
      </div>
      {config.hasMarkers && onModeChange && (
        <RelayModeSelect mode={currentMode} onChange={onModeChange} />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
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
  config: RelayListKindConfig;
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
      read: mode === "readwrite" || mode === "read",
      write: mode === "readwrite" || mode === "write",
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
    <div className="space-y-1.5 pt-2">
      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="wss://relay.example.com"
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
  onChange,
}: {
  config: RelayListKindConfig;
  entries: RelayEntry[];
  onChange: (entries: RelayEntry[]) => void;
}) {
  const Icon = config.icon;
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
          e.url === url
            ? {
                ...e,
                read: mode === "readwrite" || mode === "read",
                write: mode === "readwrite" || mode === "write",
              }
            : e,
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
          <Icon className="size-4 text-muted-foreground" />
          <span className="font-medium">{config.name}</span>
          <span className="text-xs text-muted-foreground">
            Kind {config.kind}
          </span>
          {entries.length > 0 && (
            <span className="text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {entries.length}
            </span>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <p className="text-xs text-muted-foreground mb-3">
          {config.description}
        </p>
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
  const event10050 = use$(
    () => (pubkey ? eventStore.replaceable(10050, pubkey, "") : undefined),
    [pubkey],
  );

  const eventsMap: Record<number, NostrEvent | undefined> = useMemo(
    () => ({
      10002: event10002,
      10006: event10006,
      10007: event10007,
      10050: event10050,
    }),
    [event10002, event10006, event10007, event10050],
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

  // Check if any list has been modified
  const hasChanges = useMemo(() => {
    for (const config of RELAY_LIST_KINDS) {
      const original = parseRelayEntries(eventsMap[config.kind], config);
      const draft = drafts[config.kind] ?? [];

      if (original.length !== draft.length) return true;

      for (let i = 0; i < original.length; i++) {
        if (
          original[i].url !== draft[i].url ||
          original[i].read !== draft[i].read ||
          original[i].write !== draft[i].write
        )
          return true;
      }
    }
    return false;
  }, [eventsMap, drafts]);

  const handleChange = useCallback((kind: number, entries: RelayEntry[]) => {
    setDrafts((prev) => ({ ...prev, [kind]: entries }));
  }, []);

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
        const original = parseRelayEntries(eventsMap[config.kind], config);
        const draft = drafts[config.kind] ?? [];

        // Skip kinds that haven't changed
        const isEqual =
          original.length === draft.length &&
          original.every(
            (o, i) =>
              o.url === draft[i].url &&
              o.read === draft[i].read &&
              o.write === draft[i].write,
          );
        if (isEqual) continue;

        const tags = buildTags(draft, config);
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
  }, [canSign, saving, eventsMap, drafts]);

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
            onChange={(entries) => handleChange(config.kind, entries)}
          />
        ))}
      </Accordion>

      <div className="flex justify-end pt-2">
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
