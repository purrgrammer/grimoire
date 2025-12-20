import { useState, useMemo } from "react";
import {
  Search,
  WandSparkles,
  Trash2,
  Send,
  Cloud,
  Lock,
  Loader2,
  RefreshCw,
  Archive,
  WandSparkles as Wand,
  BookUp,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { toast } from "sonner";
import { deleteSpell } from "@/services/spell-storage";
import type { LocalSpell } from "@/services/db";
import { ExecutableCommand } from "./ManPage";
import { PublishSpellAction } from "@/actions/publish-spell";
import { DeleteEventAction } from "@/actions/delete-event";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { KindBadge } from "@/components/KindBadge";
import { parseReqCommand } from "@/lib/req-parser";
import { CreateSpellDialog } from "./CreateSpellDialog";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { decodeSpell } from "@/lib/spell-conversion";
import type { SpellEvent } from "@/types/spell";

interface SpellCardProps {
  spell: LocalSpell;
  onDelete: (spell: LocalSpell) => Promise<void>;
  onPublish: (spell: LocalSpell) => Promise<void>;
}

function SpellCard({ spell, onDelete, onPublish }: SpellCardProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const displayName = spell.name || spell.alias || "Untitled Spell";

  const kinds = useMemo(() => {
    try {
      const commandWithoutReq = spell.command.replace(/^\s*req\s+/, "");
      const tokens = commandWithoutReq.split(/\s+/);
      const parsed = parseReqCommand(tokens);
      return parsed.filter.kinds || [];
    } catch {
      return [];
    }
  }, [spell.command]);

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await onPublish(spell);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(spell);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card
      className={cn(
        "group flex flex-col h-full transition-opacity",
        spell.deletedAt && "opacity-60",
      )}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center flex-wrap justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 overflow-hidden">
            <WandSparkles className="size-4 flex-shrink-0 text-muted-foreground mt-0.5" />
            <CardTitle className="text-xl truncate" title={displayName}>
              {displayName}
            </CardTitle>
          </div>
          {spell.deletedAt ? (
            <Badge variant="outline" className="text-muted-foreground">
              <Archive className="size-3 mr-1" />
            </Badge>
          ) : spell.isPublished ? (
            <Badge
              variant="secondary"
              className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20"
            >
              <Cloud className="size-3 mr-1" />
            </Badge>
          ) : (
            <Badge variant="secondary" className="opacity-70">
              <Lock className="size-3 mr-1" />
            </Badge>
          )}
        </div>
        {spell.description && (
          <CardDescription className="text-sm line-clamp-2">
            {spell.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="p-4 pt-0 flex-1">
        <div className="flex flex-col gap-2">
          <ExecutableCommand
            commandLine={spell.command}
            className="text-xs truncate line-clamp-1 text-primary hover:underline cursor-pointer"
          >
            {spell.command}
          </ExecutableCommand>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {kinds.map((kind) => (
              <KindBadge
                key={kind}
                kind={kind}
                variant="compact"
                className="text-[10px]"
                clickable
              />
            ))}
            {spell.alias && (
              <div className="text-[10px] font-mono opacity-50 ml-auto">
                Alias: {spell.alias}
              </div>
            )}
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex-wrap gap-2 justify-between">
        <Button
          size="sm"
          variant="destructive"
          className="h-8 px-2"
          onClick={handleDelete}
          disabled={isPublishing || isDeleting || !!spell.deletedAt}
        >
          {isDeleting ? (
            <Loader2 className="size-3.5 mr-1 animate-spin" />
          ) : (
            <Trash2 className="size-3.5 mr-1" />
          )}
          {spell.deletedAt ? "Deleted" : "Delete"}
        </Button>

        {!spell.deletedAt && (
          <Button
            size="sm"
            variant={spell.isPublished ? "outline" : "default"}
            className="h-8"
            onClick={handlePublish}
            disabled={isPublishing || isDeleting}
          >
            {isPublishing ? (
              <Loader2 className="size-3.5 mr-1 animate-spin" />
            ) : spell.isPublished ? (
              <RefreshCw className="size-3.5 mr-1" />
            ) : (
              <Send className="size-3.5 mr-1" />
            )}
            {isPublishing
              ? spell.isPublished
                ? "Rebroadcasting..."
                : "Publishing..."
              : spell.isPublished
                ? "Rebroadcast"
                : "Publish"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/**
 * SpellsViewer - Browse and manage saved spells
 * Shows both local and published spells with search/filter capabilities
 */
export function SpellsViewer() {
  const { state } = useGrimoire();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "local" | "published">(
    "all",
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Load spells from storage with live query
  const localSpells = useLiveQuery(() =>
    db.spells.orderBy("createdAt").reverse().toArray(),
  );

  // Fetch spells from Nostr if logged in
  const { events: networkEvents, loading: networkLoading } = useReqTimeline(
    state.activeAccount ? `user-spells-${state.activeAccount.pubkey}` : "none",
    state.activeAccount
      ? { kinds: [777], authors: [state.activeAccount.pubkey] }
      : [],
    state.activeAccount?.relays?.map((r) => r.url) || [],
    { stream: true },
  );

  const loading = localSpells === undefined;

  // Filter and sort spells
  const { filteredSpells, totalCount } = useMemo(() => {
    // Start with local spells
    const allSpellsMap = new Map<string, LocalSpell>();
    for (const s of localSpells || []) {
      allSpellsMap.set(s.eventId || s.id, s);
    }

    // Merge in network spells
    for (const event of networkEvents) {
      if (allSpellsMap.has(event.id)) continue;

      try {
        const decoded = decodeSpell(event as SpellEvent);
        const spell: LocalSpell = {
          id: event.id,
          name: decoded.name,
          command: decoded.command,
          description: decoded.description,
          createdAt: event.created_at * 1000,
          isPublished: true,
          eventId: event.id,
          event: event as SpellEvent,
        };
        allSpellsMap.set(event.id, spell);
      } catch (e) {
        console.warn("Failed to decode network spell", event.id, e);
      }
    }

    const allMerged = Array.from(allSpellsMap.values());
    const total = allMerged.length;
    let filtered = [...allMerged];

    // Filter by type
    if (filterType === "local") {
      filtered = filtered.filter((s) => !s.isPublished || !!s.deletedAt);
    } else if (filterType === "published") {
      filtered = filtered.filter((s) => s.isPublished && !s.deletedAt);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.name?.toLowerCase().includes(query) ||
          s.alias?.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query) ||
          s.command.toLowerCase().includes(query),
      );
    }

    // Sort: non-deleted first, then by createdAt descending
    filtered.sort((a, b) => {
      if (!!a.deletedAt !== !!b.deletedAt) {
        return a.deletedAt ? 1 : -1;
      }
      return b.createdAt - a.createdAt;
    });

    return { filteredSpells: filtered, totalCount: total };
  }, [localSpells, networkEvents, searchQuery, filterType]);

  // Handle deleting a spell
  const handleDeleteSpell = async (spell: LocalSpell) => {
    const isPublic = spell.isPublished && spell.eventId;
    const confirmMsg = isPublic
      ? `Are you sure you want to delete "${spell.name || spell.alias || "this spell"}"? This will also send a deletion request to Nostr relays.`
      : `Are you sure you want to delete "${spell.name || spell.alias || "this spell"}"?`;

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      // 1. If published, send Nostr Kind 5
      if (isPublic && spell.event) {
        toast.promise(
          new DeleteEventAction().execute(spell, "Deleted by user in Grimoire"),
          {
            loading: "Sending Nostr deletion request...",
            success: "Deletion request broadcasted",
            error: "Failed to broadcast deletion request",
          },
        );
      }

      // 2. Mark as deleted in local DB
      await deleteSpell(spell.id);
      toast.success(`"${spell.name || spell.alias || "spell"}" archived`);
    } catch (error) {
      console.error("Failed to delete spell:", error);
      toast.error("Failed to delete spell");
    }
  };

  const handlePublishSpell = async (spell: LocalSpell) => {
    try {
      const action = new PublishSpellAction();
      const writeRelays =
        state.activeAccount?.relays?.filter((r) => r.write).map((r) => r.url) ||
        [];
      await action.execute(spell, writeRelays);
      toast.success(
        spell.isPublished
          ? `Rebroadcasted "${spell.name || spell.alias || "spell"}"`
          : `Published "${spell.name || spell.alias || "spell"}"`,
      );
    } catch (error) {
      console.error("Failed to publish spell:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to publish spell",
      );
      throw error; // Re-throw to let the card know it failed
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <WandSparkles className="size-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Spells</h2>
            <Badge variant="secondary" className="ml-2">
              {filteredSpells.length}/{totalCount}
            </Badge>
            {networkLoading && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCreateOpen(true)}
          >
            <Wand className="size-4 mr-1.5" />
            Create Spell
          </Button>
        </div>

        {/* Search and filters */}
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search spells..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Type filter buttons */}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={filterType === "all" ? "default" : "outline"}
              onClick={() => setFilterType("all")}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={filterType === "local" ? "default" : "outline"}
              onClick={() => setFilterType("local")}
            >
              Local
            </Button>
            <Button
              size="sm"
              variant={filterType === "published" ? "default" : "outline"}
              onClick={() => setFilterType("published")}
            >
              Published
            </Button>
          </div>
        </div>
      </div>

      {!loading && searchQuery === "" && filterType !== "local" && (
        <div className="px-4 py-3 border-b border-border bg-accent/5 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-accent">
              <BookUp className="size-4" />
              Enhance your grimoire
            </div>
            <p className="text-xs text-muted-foreground">
              Browse spells published by your contacts.
            </p>
          </div>
          <ExecutableCommand
            commandLine="req -k 777 -a $contacts"
            className="text-xs font-mono px-3 py-2 bg-background border border-border rounded-md text-primary hover:underline cursor-pointer transition-colors hover:border-accent/50 h-auto"
          >
            req -k 777 -a $contacts
          </ExecutableCommand>
        </div>
      )}

      {/* Spell list */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <WandSparkles className="size-8 mx-auto mb-2 animate-pulse" />
              <p>Loading spells...</p>
            </div>
          </div>
        ) : filteredSpells.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center max-w-md">
              <WandSparkles className="size-12 mx-auto mb-3 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No spells found</h3>
              <p className="text-sm mb-4">
                {searchQuery
                  ? "Try a different search query"
                  : "Create your first spell from any REQ window"}
              </p>
              <p className="text-xs">
                Open a REQ window and click the "Save as Spell" button to create
                a spell
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filteredSpells.map((spell) => (
              <SpellCard
                key={spell.id}
                spell={spell}
                onDelete={handleDeleteSpell}
                onPublish={handlePublishSpell}
              />
            ))}
          </div>
        )}
      </div>

      <CreateSpellDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}
