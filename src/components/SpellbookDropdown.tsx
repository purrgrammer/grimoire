import { useMemo, useState } from "react";
import { BookHeart, ChevronDown, Plus, Save, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { useGrimoire } from "@/core/state";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { createSpellbook, parseSpellbook } from "@/lib/spellbook-manager";
import type { SpellbookEvent, ParsedSpellbook } from "@/types/spell";
import { SPELLBOOK_KIND } from "@/constants/kinds";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PublishSpellbookAction } from "@/actions/publish-spellbook";
import { saveSpellbook } from "@/services/spellbook-storage";
import { SaveSpellbookDialog } from "./SaveSpellbookDialog";

export function SpellbookDropdown() {
  const { state, loadSpellbook, addWindow, clearActiveSpellbook } =
    useGrimoire();
  const activeAccount = state.activeAccount;
  const activeSpellbook = state.activeSpellbook;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // 1. Load Local Data
  const localSpellbooks = useLiveQuery(() =>
    db.spellbooks.toArray().then((books) => books.filter((b) => !b.deletedAt)),
  );

  // 2. Fetch Network Data
  const { events: networkEvents } = useReqTimeline(
    activeAccount ? `header-spellbooks-${activeAccount.pubkey}` : "none",
    activeAccount
      ? { kinds: [SPELLBOOK_KIND], authors: [activeAccount.pubkey] }
      : [],
    activeAccount?.relays?.map((r) => r.url) || [],
    { stream: true },
  );

  // 3. Process Spellbooks
  const spellbooks = useMemo(() => {
    if (!activeAccount) return [];
    const allMap = new Map<string, ParsedSpellbook>();

    for (const s of localSpellbooks || []) {
      allMap.set(s.slug, {
        slug: s.slug,
        title: s.title,
        description: s.description,
        content: s.content,
        referencedSpells: [],
        event: s.event as SpellbookEvent,
      });
    }

    for (const event of networkEvents) {
      const slug = event.tags.find((t) => t[0] === "d")?.[1] || "";
      if (!slug) continue;
      const existing = allMap.get(slug);
      if (
        existing &&
        event.created_at * 1000 <= (existing.event?.created_at || 0) * 1000
      )
        continue;
      try {
        allMap.set(slug, parseSpellbook(event as SpellbookEvent));
      } catch (e) {
        // ignore
      }
    }

    return Array.from(allMap.values()).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [localSpellbooks, networkEvents, activeAccount]);

  if (!activeAccount || (spellbooks.length === 0 && !activeSpellbook)) {
    return null;
  }

  const handleApplySpellbook = (sb: ParsedSpellbook) => {
    loadSpellbook(sb);
    toast.success(`Layout "${sb.title}" applied`);
  };

  const handleUpdateActive = async () => {
    if (!activeSpellbook) return;
    setIsUpdating(true);
    try {
      // Generate current layout content
      const encoded = createSpellbook({
        state,
        title: activeSpellbook.title,
      });

      const content = JSON.parse(encoded.eventProps.content);

      // 1. Save locally
      const local = await db.spellbooks
        .where("slug")
        .equals(activeSpellbook.slug)
        .first();
      if (local) {
        await db.spellbooks.update(local.id, { content });
      } else {
        await saveSpellbook({
          slug: activeSpellbook.slug,
          title: activeSpellbook.title,
          content,
          isPublished: false,
        });
      }

      // 2. If it was published or we want to publish updates
      if (activeSpellbook.pubkey === activeAccount.pubkey) {
        const action = new PublishSpellbookAction();
        await action.execute({
          state,
          title: activeSpellbook.title,
          content,
          localId: local?.id,
        });
        toast.success(
          `Layout "${activeSpellbook.title}" updated and published`,
        );
      } else {
        toast.success(`Layout "${activeSpellbook.title}" updated locally`);
      }
    } catch (e) {
      toast.error("Failed to update layout");
    } finally {
      setIsUpdating(false);
    }
  };

  const itemClass =
    "cursor-pointer py-2 hover:bg-muted focus:bg-muted transition-colors";

  return (
    <>
      <SaveSpellbookDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground",
              activeSpellbook && "text-foreground font-bold",
            )}
          >
            <BookHeart className="size-4" />
            <span className="text-xs font-medium hidden sm:inline">
              {activeSpellbook ? activeSpellbook.title : "Layouts"}
            </span>
            <ChevronDown className="size-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          className="w-64 max-h-[80vh] overflow-y-auto"
        >
          {/* Active Spellbook Actions */}
          {activeSpellbook && (
            <>
              <DropdownMenuLabel className="py-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                Current Layout
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={handleUpdateActive}
                disabled={isUpdating}
                className={itemClass}
              >
                <Save className="size-3.5 mr-2 text-muted-foreground" />
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-sm">
                    Update "{activeSpellbook.title}"
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Save current state to this spellbook
                  </span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={clearActiveSpellbook}
                className={cn(itemClass, "text-xs opacity-70")}
              >
                <X className="size-3.5 mr-2 text-muted-foreground" />
                Stop Tracking Layout
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Spellbooks Section */}
          {spellbooks.length > 0 && (
            <>
              <DropdownMenuLabel className="flex items-center justify-between py-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                My Layouts
              </DropdownMenuLabel>
              {spellbooks.map((sb) => {
                const isActive = activeSpellbook?.slug === sb.slug;
                return (
                  <DropdownMenuItem
                    key={sb.slug}
                    onClick={() => handleApplySpellbook(sb)}
                    className={cn(itemClass, isActive && "bg-muted font-bold")}
                  >
                    <BookHeart
                      className={cn(
                        "size-3.5 mr-2 text-muted-foreground",
                        isActive && "text-foreground",
                      )}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-medium text-sm">
                        {sb.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {Object.keys(sb.content.workspaces).length} tabs
                      </span>
                    </div>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem
                onClick={() => addWindow("spellbooks", {})}
                className={cn(itemClass, "text-xs opacity-70")}
              >
                <BookHeart className="size-3 mr-2 text-muted-foreground" />
                Manage Layouts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* New Section */}
          <DropdownMenuItem
            onClick={() => setSaveDialogOpen(true)}
            className={itemClass}
          >
            <Plus className="size-3.5 mr-2 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Save as new layout
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}