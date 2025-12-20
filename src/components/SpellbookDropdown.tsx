import { useMemo, useState } from "react";
import { BookHeart, ChevronDown, Plus, Save, Settings, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { useGrimoire } from "@/core/state";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { parseSpellbook } from "@/lib/spellbook-manager";
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
import { cn } from "@/lib/utils";
import { SaveSpellbookDialog } from "./SaveSpellbookDialog";

export function SpellbookDropdown() {
  const { state, loadSpellbook, addWindow, clearActiveSpellbook, applyTemporaryToPersistent, isTemporary } =
    useGrimoire();
  const activeAccount = state.activeAccount;
  const activeSpellbook = state.activeSpellbook;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [dialogSpellbook, setDialogSpellbook] = useState<{
    slug: string;
    title: string;
    description?: string;
    workspaceIds?: string[];
    localId?: string;
    pubkey?: string;
  } | undefined>(undefined);

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

  // Check if active spellbook is in local library
  const isActiveLocal = useMemo(() => {
    if (!activeSpellbook) return false;
    return (localSpellbooks || []).some(s => s.slug === activeSpellbook.slug);
  }, [activeSpellbook, localSpellbooks]);

  if (!activeAccount || (spellbooks.length === 0 && !activeSpellbook)) {
    return null;
  }

  const handleApplySpellbook = (sb: ParsedSpellbook) => {
    loadSpellbook(sb);
  };

  const handleUpdateActive = async () => {
    if (!activeSpellbook) return;

    // Get local spellbook for ID
    const local = await db.spellbooks
      .where("slug")
      .equals(activeSpellbook.slug)
      .first();

    // Open dialog with existing spellbook data
    setDialogSpellbook({
      slug: activeSpellbook.slug,
      title: activeSpellbook.title,
      workspaceIds: Object.keys(state.workspaces),
      localId: local?.id,
      pubkey: activeSpellbook.pubkey,
    });
    setSaveDialogOpen(true);
  };

  const handleNewSpellbook = () => {
    setDialogSpellbook(undefined);
    setSaveDialogOpen(true);
  };

  const itemClass =
    "cursor-pointer py-2 hover:bg-muted focus:bg-muted transition-colors";

  return (
    <>
      <SaveSpellbookDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        existingSpellbook={isActiveLocal ? dialogSpellbook : undefined}
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
              {activeSpellbook ? activeSpellbook.title : "grimoire"}
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
                Active Layout
              </DropdownMenuLabel>
              <div className="px-2 py-1 text-sm font-medium truncate opacity-80 mb-1">
                {activeSpellbook.title || activeSpellbook.slug}
              </div>

              {isTemporary && (
                <DropdownMenuItem
                  onClick={applyTemporaryToPersistent}
                  className={cn(itemClass, "bg-accent/5 font-bold")}
                >
                  <Save className="size-3.5 mr-2" />
                  Apply to Dashboard
                </DropdownMenuItem>
              )}

              {isActiveLocal && activeSpellbook.pubkey === activeAccount.pubkey ? (
                <DropdownMenuItem
                  onClick={handleUpdateActive}
                  className={itemClass}
                >
                  <Save className="size-3.5 mr-2 text-muted-foreground" />
                  Update
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={handleUpdateActive}
                  className={itemClass}
                >
                  <Plus className="size-3.5 mr-2 text-muted-foreground" />
                  Add to Library
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onClick={clearActiveSpellbook}
                className={cn(itemClass, "text-xs opacity-70")}
              >
                <X className="size-3.5 mr-2 text-muted-foreground" />
                Deselect
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Spellbooks Section */}
          <DropdownMenuLabel className="flex items-center justify-between py-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            My Layouts
          </DropdownMenuLabel>
          
          {spellbooks.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground italic">
              No layouts saved yet.
            </div>
          ) : (
            spellbooks.map((sb) => {
              const isActive = activeSpellbook?.slug === sb.slug;
              return (
                <DropdownMenuItem
                  key={sb.slug}
                  disabled={isActive}
                  onClick={() => handleApplySpellbook(sb)}
                  className={cn(itemClass, isActive && "bg-muted font-bold")}
                >
                  <BookHeart
                    className={cn(
                      "size-3.5 mr-2 text-muted-foreground",
                      isActive && "text-foreground",
                    )}
                  />
                  <div className="flex flex-row gap-0 min-w-0">
                    <span className="truncate font-medium text-sm">
                      {sb.title}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}

          <DropdownMenuSeparator />
          
          {!activeSpellbook && (
            <DropdownMenuItem
              onClick={handleNewSpellbook}
              className={itemClass}
            >
              <Plus className="size-3.5 mr-2 text-muted-foreground" />
              <span className="text-sm font-medium">Save current as Layout</span>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            onClick={() => addWindow("spellbooks", {})}
            className={cn(itemClass, "text-xs opacity-70")}
          >
            <Settings className="size-3.5 mr-2 text-muted-foreground" />
            Manage Library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
