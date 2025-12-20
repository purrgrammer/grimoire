import { useMemo } from "react";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { SpellbookEvent } from "@/types/spell";
import { NostrEvent } from "@/types/nostr";
import { Grid3x3, Layout, ExternalLink, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGrimoire } from "@/core/state";
import { toast } from "sonner";

/**
 * Renderer for Kind 30777 - Spellbook (Layout Configuration)
 * Displays spellbook title, description, and counts in feed
 */
export function SpellbookRenderer({ event }: BaseEventProps) {
  const spellbook = useMemo(() => {
    try {
      return parseSpellbook(event as SpellbookEvent);
    } catch (e) {
      return null;
    }
  }, [event]);

  if (!spellbook) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-destructive text-sm italic">Failed to parse spellbook data</div>
      </BaseEventContainer>
    );
  }

  const workspaceCount = Object.keys(spellbook.content.workspaces).length;
  const windowCount = Object.keys(spellbook.content.windows).length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        {/* Title */}
        <div className="flex items-center gap-2">
          <Grid3x3 className="size-4 text-accent" />
          <ClickableEventTitle
            event={event}
            className="text-lg font-bold text-foreground"
          >
            {spellbook.title}
          </ClickableEventTitle>
        </div>

        {/* Description */}
        {spellbook.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {spellbook.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground font-mono">
          <div className="flex items-center gap-1">
            <Layout className="size-3" />
            {workspaceCount} {workspaceCount === 1 ? 'workspace' : 'workspaces'}
          </div>
          <div className="flex items-center gap-1">
            <ExternalLink className="size-3" />
            {windowCount} {windowCount === 1 ? 'window' : 'windows'}
          </div>
        </div>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Detail renderer for Kind 30777 - Spellbook
 * Shows detailed workspace information and Apply Layout button
 */
export function SpellbookDetailRenderer({ event }: { event: NostrEvent }) {
  const { loadSpellbook } = useGrimoire();
  
  const spellbook = useMemo(() => {
    try {
      return parseSpellbook(event as SpellbookEvent);
    } catch (e) {
      return null;
    }
  }, [event]);

  if (!spellbook) {
    return <div className="p-4 text-destructive italic">Failed to parse spellbook data</div>;
  }

  const handleApply = () => {
    loadSpellbook(spellbook);
    toast.success("Layout applied", {
      description: `Replaced current layout with ${Object.keys(spellbook.content.workspaces).length} workspaces.`,
    });
  };

  const sortedWorkspaces = Object.values(spellbook.content.workspaces).sort((a, b) => a.number - b.number);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Grid3x3 className="size-6 text-accent" />
            </div>
            <h2 className="text-3xl font-bold">{spellbook.title}</h2>
          </div>
          {spellbook.description && (
            <p className="text-lg text-muted-foreground">{spellbook.description}</p>
          )}
        </div>
        
        <Button 
          size="lg" 
          onClick={handleApply}
          className="bg-accent hover:bg-accent/90 text-accent-foreground flex items-center gap-2 h-12 px-6 text-lg font-bold"
        >
          <Play className="size-5 fill-current" />
          Apply Layout
        </Button>
      </div>

      {/* Workspaces Summary */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Layout className="size-4" />
          Workspaces Content
        </h3>
        
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {sortedWorkspaces.map((ws) => {
            const wsWindows = ws.windowIds.length;
            return (
              <div 
                key={ws.id} 
                className="p-4 rounded-xl border border-border bg-card/50 flex items-center justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-mono text-muted-foreground">Workspace {ws.number}</span>
                  <span className="font-bold">{ws.label || 'Untitled Workspace'}</span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-muted rounded-full text-xs font-medium">
                  <ExternalLink className="size-3" />
                  {wsWindows} {wsWindows === 1 ? 'window' : 'windows'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Technical Data / Reference */}
      <div className="mt-8 pt-8 border-t border-border/50">
        <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
          <div className="flex gap-4">
            <span>D-TAG: {spellbook.slug}</span>
            <span>VERSION: {spellbook.content.version}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
