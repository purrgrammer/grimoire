import { useMemo } from "react";
import { BookHeart, ChevronDown, WandSparkles } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { useGrimoire } from "@/core/state";
import { useReqTimeline } from "@/hooks/useReqTimeline";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { decodeSpell } from "@/lib/spell-conversion";
import type {
  SpellbookEvent,
  ParsedSpellbook,
  SpellEvent,
  ParsedSpell,
} from "@/types/spell";
import { SPELLBOOK_KIND, SPELL_KIND } from "@/constants/kinds";
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
import { manPages } from "@/types/man";
import { cn } from "@/lib/utils";

export function SpellbookDropdown() {
  const { state, loadSpellbook, addWindow } = useGrimoire();
  const activeAccount = state.activeAccount;

  // 1. Load Local Data
  const localSpellbooks = useLiveQuery(() =>
    db.spellbooks.toArray().then((books) => books.filter((b) => !b.deletedAt)),
  );
  const localSpells = useLiveQuery(() =>
    db.spells.toArray().then((spells) => spells.filter((s) => !s.deletedAt)),
  );

  // 2. Fetch Network Data
  const { events: networkEvents, loading: networkLoading } = useReqTimeline(
    activeAccount ? `header-resources-${activeAccount.pubkey}` : "none",
    activeAccount
      ? { kinds: [SPELLBOOK_KIND, SPELL_KIND], authors: [activeAccount.pubkey] }
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

    for (const event of networkEvents.filter((e) => e.kind === SPELLBOOK_KIND)) {
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

  // 4. Process Spells
  const spells = useMemo(() => {
    if (!activeAccount) return [];
    const allMap = new Map<string, ParsedSpell>();

    for (const s of localSpells || []) {
      // Use eventId if available, otherwise fallback to local id for deduplication
      const key = s.eventId || s.id;
      allMap.set(key, {
        name: s.name || s.alias,
        command: s.command,
        description: s.description,
        event: s.event as SpellEvent,
        filter: {},
        topics: [],
        closeOnEose: false,
      });
    }

    for (const event of networkEvents.filter((e) => e.kind === SPELL_KIND)) {
      if (allMap.has(event.id)) continue;
      try {
        allMap.set(event.id, decodeSpell(event as SpellEvent));
      } catch (e) {
        // ignore
      }
    }

    return Array.from(allMap.values()).sort((a, b) =>
      (a.name || "Untitled").localeCompare(b.name || "Untitled"),
    );
  }, [localSpells, networkEvents, activeAccount]);

  if (
    !activeAccount ||
    (spellbooks.length === 0 && spells.length === 0 && !networkLoading)
  ) {
    return null;
  }

  const handleApplySpellbook = (sb: ParsedSpellbook) => {
    loadSpellbook(sb);
    toast.success(`Layout "${sb.title}" applied`);
  };

  const handleRunSpell = async (spell: ParsedSpell) => {
    try {
      const parts = spell.command.trim().split(/\s+/);
      const commandName = parts[0]?.toLowerCase();
      const cmdArgs = parts.slice(1);
      const command = manPages[commandName];

      if (command) {
        const cmdProps = command.argParser
          ? await Promise.resolve(command.argParser(cmdArgs))
          : command.defaultProps || {};
        addWindow(command.appId, cmdProps, spell.command);
        toast.success(`Ran spell: ${spell.name || "Untitled"}`);
      }
    } catch (e) {
      toast.error("Failed to run spell");
    }
  };

  const itemClass =
    "cursor-pointer py-2 hover:bg-muted focus:bg-muted transition-colors";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <BookHeart className="size-4" />
          <span className="text-xs font-medium hidden sm:inline">Library</span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-64 max-h-[80vh] overflow-y-auto"
      >
        {/* Spellbooks Section */}
        {spellbooks.length > 0 && (
          <>
            <DropdownMenuLabel className="flex items-center justify-between py-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Spellbooks
            </DropdownMenuLabel>
            {spellbooks.map((sb) => (
              <DropdownMenuItem
                key={sb.slug}
                onClick={() => handleApplySpellbook(sb)}
                className={itemClass}
              >
                <BookHeart className="size-3.5 mr-2 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium text-sm">
                    {sb.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {Object.keys(sb.content.workspaces).length} tabs
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onClick={() => addWindow("spellbooks", {})}
              className={cn(itemClass, "text-xs opacity-70")}
            >
              <BookHeart className="size-3 mr-2 text-muted-foreground" />
              Manage Library
            </DropdownMenuItem>
          </>
        )}

        {/* Spells Section */}
        {spells.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center justify-between py-1 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Spells
            </DropdownMenuLabel>
            {spells.map((s, idx) => (
              <DropdownMenuItem
                key={s.event?.id || `local-${idx}`}
                onClick={() => handleRunSpell(s)}
                className={itemClass}
              >
                <WandSparkles className="size-3.5 mr-2 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium text-sm">
                    {s.name || "Untitled Spell"}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate font-mono">
                    {s.command}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onClick={() => addWindow("spells", {})}
              className={cn(itemClass, "text-xs opacity-70")}
            >
                          <WandSparkles className="size-3 mr-2 text-muted-foreground" />
                          Manage Spells
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
              }
              
