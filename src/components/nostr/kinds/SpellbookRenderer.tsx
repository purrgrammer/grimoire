import { useMemo } from "react";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { SpellbookEvent, ParsedSpellbook } from "@/types/spell";
import { NostrEvent } from "@/types/nostr";
import { BookHeart, Layout, ExternalLink, Play, Eye, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGrimoire } from "@/core/state";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router";
import { KindBadge } from "@/components/KindBadge";
import { WindowInstance } from "@/types/app";

/**
 * Helper to extract all unique event kinds from a spellbook's windows
 */
function getSpellbookKinds(spellbook: ParsedSpellbook): number[] {
  const kinds = new Set<number>();
  Object.values(spellbook.content.windows).forEach((w) => {
    const window = w as WindowInstance;
    // If it's a req window, extract kinds from filter
    if (window.appId === "req" && window.props?.filter?.kinds) {
      window.props.filter.kinds.forEach((k: number) => kinds.add(k));
    }
  });
  return Array.from(kinds).sort((a, b) => a - b);
}

/**
 * Preview Button Component
 * Navigates to /<npub|nip05>/<identifier>
 */
function PreviewButton({ event, identifier, size = "default", className = "" }: { 
  event: NostrEvent, 
  identifier: string,
  size?: "default" | "sm" | "lg" | "icon",
  className?: string
}) {
  const profile = useProfile(event.pubkey);
  const navigate = useNavigate();
  
  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    const actor = profile?.nip05 || nip19.npubEncode(event.pubkey);
    navigate(`/preview/${actor}/${identifier}`);
  };

  return (
    <Button 
      variant="outline" 
      size={size} 
      onClick={handlePreview}
      className={`flex items-center gap-2 ${className}`}
    >
      <Eye className="size-4" />
      {size !== "icon" && "Preview"}
    </Button>
  );
}

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
        <div className="text-destructive text-sm italic">
          Failed to parse spellbook data
        </div>
      </BaseEventContainer>
    );
  }

  const workspaceCount = Object.keys(spellbook.content.workspaces).length;
  const windowCount = Object.keys(spellbook.content.windows).length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            {/* Title */}
            <div className="flex items-center gap-2 min-w-0">
              <BookHeart className="size-4 text-accent flex-shrink-0" />
              <ClickableEventTitle
                event={event}
                className="text-lg font-bold text-foreground truncate"
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
          </div>

          <PreviewButton event={event} identifier={spellbook.slug} size="sm" className="flex-shrink-0" />
        </div>

        {/* Kind Badges */}
        {getSpellbookKinds(spellbook).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {getSpellbookKinds(spellbook).map((kind) => (
              <KindBadge
                key={kind}
                kind={kind}
                variant="compact"
                className="text-[10px]"
                showName
                clickable
              />
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground font-mono">
          <div className="flex items-center gap-1">
            <Layout className="size-3 flex-shrink-0" />
            {workspaceCount} {workspaceCount === 1 ? "tab" : "tabs"}
          </div>
          <div className="flex items-center gap-1">
            <ExternalLink className="size-3 flex-shrink-0" />
            {windowCount} {windowCount === 1 ? "window" : "windows"}
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
  const profile = useProfile(event.pubkey);

  const spellbook = useMemo(() => {
    try {
      return parseSpellbook(event as SpellbookEvent);
    } catch (e) {
      return null;
    }
  }, [event]);

  if (!spellbook) {
    return (
      <div className="p-4 text-destructive italic">
        Failed to parse spellbook data
      </div>
    );
  }

  const handleApply = () => {
    loadSpellbook(spellbook);
    toast.success("Layout applied", {
      description: `Replaced current layout with ${Object.keys(spellbook.content.workspaces).length} workspaces.`,
    });
  };

  const handleCopyLink = () => {
    const actor = profile?.nip05 || nip19.npubEncode(event.pubkey);
    const url = `${window.location.origin}/${actor}/${spellbook.slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Preview link copied to clipboard");
  };

  const sortedWorkspaces = Object.values(spellbook.content.workspaces).sort(
    (a, b) => a.number - b.number,
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between border-b border-border/50 pb-6">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-accent/10 rounded-xl">
              <BookHeart className="size-8 text-accent" />
            </div>
            <ClickableEventTitle 
              event={event} 
              className="text-3xl font-bold truncate hover:underline cursor-pointer"
            >
              {spellbook.title}
            </ClickableEventTitle>
          </div>
          
          {getSpellbookKinds(spellbook).length > 0 && (
            <div className="flex flex-wrap gap-2 py-1">
              {getSpellbookKinds(spellbook).map((kind) => (
                <KindBadge
                  key={kind}
                  kind={kind}
                  showName
                  clickable
                />
              ))}
            </div>
          )}

          {spellbook.description && (
            <p className="text-lg text-muted-foreground">
              {spellbook.description}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button 
            variant="outline" 
            size="lg" 
            onClick={handleCopyLink}
            className="flex items-center gap-2 h-12 px-5"
          >
            <Share2 className="size-5" />
            Share Link
          </Button>
          
          <PreviewButton 
            event={event} 
            identifier={spellbook.slug} 
            size="lg" 
            className="bg-background"
          />

          <Button
            size="lg"
            onClick={handleApply}
            className="bg-accent hover:bg-accent/90 text-accent-foreground flex items-center gap-2 h-12 px-6 text-lg font-bold"
          >
            <Play className="size-5 fill-current" />
            Apply Layout
          </Button>
        </div>
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
                  <span className="text-sm font-mono text-muted-foreground">
                    Workspace {ws.number}
                  </span>
                  <span className="font-bold">
                    {ws.label || "Untitled Workspace"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 px-3 py-1 bg-muted rounded-full text-xs font-medium">
                  <ExternalLink className="size-3" />
                  {wsWindows} {wsWindows === 1 ? "window" : "windows"}
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
