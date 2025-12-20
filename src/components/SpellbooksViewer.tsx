import { useState, useMemo } from "react";
import {
  Search,
  Grid3x3,
  Trash2,
  Send,
  Cloud,
  Lock,
  Loader2,
  RefreshCw,
  Archive,
  Layout,
  ExternalLink,
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
import { deleteSpellbook } from "@/services/spellbook-storage";
import type { LocalSpellbook } from "@/services/db";
import { PublishSpellbookAction } from "@/actions/publish-spellbook";
import { DeleteEventAction } from "@/actions/delete-event";
import { useGrimoire } from "@/core/state";
import { cn } from "@/lib/utils";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { parseSpellbook } from "@/lib/spellbook-manager";
import type { SpellbookEvent, ParsedSpellbook } from "@/types/spell";
import { SPELLBOOK_KIND } from "@/constants/kinds";

interface SpellbookCardProps {
  spellbook: LocalSpellbook;
  onDelete: (spellbook: LocalSpellbook) => Promise<void>;
  onPublish: (spellbook: LocalSpellbook) => Promise<void>;
  onApply: (spellbook: ParsedSpellbook) => void;
}

function SpellbookCard({
  spellbook,
  onDelete,
  onPublish,
  onApply,
}: SpellbookCardProps) {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const displayName = spellbook.title || "Untitled Spellbook";

  const workspaceCount = Object.keys(spellbook.content.workspaces).length;
  const windowCount = Object.keys(spellbook.content.windows).length;

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      await onPublish(spellbook);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(spellbook);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApply = () => {
    // Construct a ParsedSpellbook from LocalSpellbook for applying
    const parsed: ParsedSpellbook = {
      slug: spellbook.slug,
      title: spellbook.title,
      description: spellbook.description,
      content: spellbook.content,
      referencedSpells: [], // We don't need this for applying
      event: spellbook.event as SpellbookEvent,
    };
    onApply(parsed);
  };

  return (
    <Card
      className={cn(
        "group flex flex-col h-full transition-opacity",
        spellbook.deletedAt && "opacity-60",
      )}
    >
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center flex-wrap justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 overflow-hidden">
            <Grid3x3 className="size-4 flex-shrink-0 text-muted-foreground mt-0.5" />
            <CardTitle className="text-xl truncate" title={displayName}>
              {displayName}
            </CardTitle>
          </div>
          {spellbook.deletedAt ? (
            <Badge variant="outline" className="text-muted-foreground">
              <Archive className="size-3 mr-1" />
            </Badge>
          ) : spellbook.isPublished ? (
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
        {spellbook.description && (
          <CardDescription className="text-sm line-clamp-2">
            {spellbook.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="p-4 pt-0 flex-1">
        <div className="flex flex-col gap-2">
          <div className="flex gap-4 mt-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Layout className="size-3" />
              {workspaceCount}{" "}
              {workspaceCount === 1 ? "workspace" : "workspaces"}
            </div>
            <div className="flex items-center gap-1">
              <ExternalLink className="size-3" />
              {windowCount} {windowCount === 1 ? "window" : "windows"}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex-wrap gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="h-8 px-2"
            onClick={handleDelete}
            disabled={isPublishing || isDeleting || !!spellbook.deletedAt}
          >
            {isDeleting ? (
              <Loader2 className="size-3.5 mr-1 animate-spin" />
            ) : (
              <Trash2 className="size-3.5 mr-1" />
            )}
            {spellbook.deletedAt ? "Deleted" : "Delete"}
          </Button>

          {!spellbook.deletedAt && (
            <Button
              size="sm"
              variant={spellbook.isPublished ? "outline" : "default"}
              className="h-8"
              onClick={handlePublish}
              disabled={isPublishing || isDeleting}
            >
              {isPublishing ? (
                <Loader2 className="size-3.5 mr-1 animate-spin" />
              ) : spellbook.isPublished ? (
                <RefreshCw className="size-3.5 mr-1" />
              ) : (
                <Send className="size-3.5 mr-1" />
              )}
              {isPublishing
                ? "Publishing..."
                : spellbook.isPublished
                  ? "Rebroadcast"
                  : "Publish"}
            </Button>
          )}
        </div>

        {!spellbook.deletedAt && (
          <Button
            size="sm"
            variant="default"
            className="h-8"
            onClick={handleApply}
          >
            Apply Layout
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export function SpellbooksViewer() {
  const { state, loadSpellbook } = useGrimoire();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "local" | "published">(
    "all",
  );

  // Load local spellbooks from Dexie
  const localSpellbooks = useLiveQuery(() =>
    db.spellbooks.orderBy("createdAt").reverse().toArray(),
  );

  // Fetch from Nostr
  const { events: networkEvents, loading: networkLoading } = useReqTimeline(
    state.activeAccount
      ? `user-spellbooks-${state.activeAccount.pubkey}`
      : "none",
    state.activeAccount
      ? { kinds: [SPELLBOOK_KIND], authors: [state.activeAccount.pubkey] }
      : [],
    state.activeAccount?.relays?.map((r) => r.url) || [],
    { stream: true },
  );

  const loading = localSpellbooks === undefined;

  // Filter and sort
  const { filteredSpellbooks, totalCount } = useMemo(() => {
    const allSpellbooksMap = new Map<string, LocalSpellbook>();
    for (const s of localSpellbooks || []) {
      allSpellbooksMap.set(s.id, s);
    }

    for (const event of networkEvents) {
      // Find d tag for matching with local slug
      const slug = event.tags.find((t) => t[0] === "d")?.[1] || "";

      // Look for existing by slug + pubkey? For now just ID matching if we have it
      // Replaceable events are tricky. Let's match by slug if localId not found.
      const existing = Array.from(allSpellbooksMap.values()).find(
        (s) => s.slug === slug,
      );

      if (existing) {
        // Update existing with network event if it's newer
        if (event.created_at * 1000 > existing.createdAt) {
          existing.isPublished = true;
          existing.eventId = event.id;
          existing.event = event as SpellbookEvent;
        }
        continue;
      }

      try {
        const parsed = parseSpellbook(event as SpellbookEvent);
        const spellbook: LocalSpellbook = {
          id: event.id,
          slug: parsed.slug,
          title: parsed.title,
          description: parsed.description,
          content: parsed.content,
          createdAt: event.created_at * 1000,
          isPublished: true,
          eventId: event.id,
          event: event as SpellbookEvent,
        };
        allSpellbooksMap.set(event.id, spellbook);
      } catch (e) {
        console.warn("Failed to decode network spellbook", event.id, e);
      }
    }

    const allMerged = Array.from(allSpellbooksMap.values());
    const total = allMerged.length;
    let filtered = [...allMerged];

    if (filterType === "local") {
      filtered = filtered.filter((s) => !s.isPublished || !!s.deletedAt);
    } else if (filterType === "published") {
      filtered = filtered.filter((s) => s.isPublished && !s.deletedAt);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.title?.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query),
      );
    }

    filtered.sort((a, b) => {
      if (!!a.deletedAt !== !!b.deletedAt) return a.deletedAt ? 1 : -1;
      return b.createdAt - a.createdAt;
    });

    return { filteredSpellbooks: filtered, totalCount: total };
  }, [localSpellbooks, networkEvents, searchQuery, filterType]);

  const handleDelete = async (spellbook: LocalSpellbook) => {
    if (!confirm(`Delete spellbook "${spellbook.title}"?`)) return;

    try {
      if (spellbook.isPublished && spellbook.event) {
        await new DeleteEventAction().execute(
          { event: spellbook.event },
          "Deleted by user",
        );
      }
      await deleteSpellbook(spellbook.id);
      toast.success("Spellbook deleted");
    } catch (error) {
      toast.error("Failed to delete spellbook");
    }
  };

  const handlePublish = async (spellbook: LocalSpellbook) => {
    try {
      const action = new PublishSpellbookAction();
      await action.execute({
        state,
        title: spellbook.title,
        description: spellbook.description,
        workspaceIds: Object.keys(spellbook.content.workspaces),
        localId: spellbook.id,
        content: spellbook.content, // Pass existing content
      });
      toast.success("Spellbook published");
    } catch (error) {
      toast.error("Failed to publish");
    }
  };

  const handleApply = (spellbook: ParsedSpellbook) => {
    loadSpellbook(spellbook);
    toast.success("Layout applied", {
      description: `Replaced current layout with ${Object.keys(spellbook.content.workspaces).length} workspaces.`,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Grid3x3 className="size-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Spellbooks</h2>
            <Badge variant="secondary" className="ml-2">
              {filteredSpellbooks.length}/{totalCount}
            </Badge>
            {networkLoading && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search spellbooks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
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

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredSpellbooks.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No spellbooks found.
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1">
            {filteredSpellbooks.map((s) => (
              <SpellbookCard
                key={s.id}
                spellbook={s}
                onDelete={handleDelete}
                onPublish={handlePublish}
                onApply={handleApply}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
