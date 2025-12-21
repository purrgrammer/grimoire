import { useMemo, useState } from "react";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { SpellbookEvent, ParsedSpellbook } from "@/types/spell";
import { NostrEvent } from "@/types/nostr";
import { Layout, ExternalLink, Eye, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useProfile } from "@/hooks/useProfile";
import { nip19 } from "nostr-tools";
import { useNavigate } from "react-router";
import { KindBadge } from "@/components/KindBadge";
import { WindowInstance } from "@/types/app";
import { ShareSpellbookDialog } from "@/components/ShareSpellbookDialog";

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
function PreviewButton({
  event,
  identifier,
  size = "default",
  className = "",
}: {
  event: NostrEvent;
  identifier: string;
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}) {
  const profile = useProfile(event.pubkey);
  const navigate = useNavigate();

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    const actor = profile?.nip05 || nip19.npubEncode(event.pubkey);
    navigate(`/preview/${actor}/${identifier}`, { state: { fromApp: true } });
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
 * Renders a visual representation of the window layout using flex boxes
 */
function LayoutVisualizer({
  layout,
  windows,
}: {
  layout: any;
  windows: Record<string, WindowInstance>;
}) {
  const renderLayout = (node: any): React.ReactNode => {
    // Leaf node - single window
    if (typeof node === "string") {
      const window = windows[node];
      const appId = window?.appId || "unknown";

      // For req windows, show kind badges if available
      if (appId === "req" && window?.props?.filter?.kinds) {
        const kinds = window.props.filter.kinds;
        return (
          <div
            style={{
              flex: 1,
              minHeight: "40px",
              minWidth: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: "2px",
              borderRadius: "4px",
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--muted))",
              padding: "4px",
            }}
          >
            {kinds.map((kind: number) => (
              <KindBadge
                key={kind}
                kind={kind}
                variant="compact"
                className="text-[8px] h-4 px-1"
                showName={false}
              />
            ))}
          </div>
        );
      }

      // Default: show appId as text
      return (
        <div
          style={{
            flex: 1,
            minHeight: "40px",
            minWidth: "40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "10px",
            fontWeight: 500,
            borderRadius: "4px",
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--muted))",
            padding: "4px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={appId}
        >
          {appId}
        </div>
      );
    }

    // Branch node - split
    if (node && typeof node === "object" && "first" in node && "second" in node) {
      const isRow = node.direction === "row";
      const splitPercentage = node.splitPercentage ?? 50; // Default to 50/50 if not specified

      return (
        <div
          style={{
            display: "flex",
            flexDirection: isRow ? "row" : "column",
            gap: "4px",
            flex: 1,
            minHeight: isRow ? "40px" : "80px",
            minWidth: isRow ? "80px" : "40px",
          }}
        >
          <div style={{ flexGrow: splitPercentage, minHeight: "40px", minWidth: "40px", display: "flex" }}>
            {renderLayout(node.first)}
          </div>
          <div style={{ flexGrow: 100 - splitPercentage, minHeight: "40px", minWidth: "40px", display: "flex" }}>
            {renderLayout(node.second)}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: "60px",
        display: "flex",
        padding: "8px",
        borderRadius: "8px",
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
      }}
    >
      {renderLayout(layout)}
    </div>
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
            <ClickableEventTitle
              event={event}
              className="text-lg font-bold text-foreground truncate"
            >
              {spellbook.title}
            </ClickableEventTitle>

            {/* Description */}
            {spellbook.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {spellbook.description}
              </p>
            )}
          </div>

          <PreviewButton
            event={event}
            identifier={spellbook.slug}
            size="sm"
            className="flex-shrink-0"
          />
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
 * Shows detailed workspace information with preview and sharing options
 */
export function SpellbookDetailRenderer({ event }: { event: NostrEvent }) {
  const profile = useProfile(event.pubkey);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

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

  const sortedWorkspaces = Object.values(spellbook.content.workspaces).sort(
    (a, b) => a.number - b.number,
  );

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-border/50 pb-6">
        <h1 className="text-3xl font-bold truncate">{spellbook.title}</h1>

        {spellbook.description && (
          <p className="text-lg text-muted-foreground">
            {spellbook.description}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShareDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <Share2 className="size-4" />
            Share
          </Button>

          <PreviewButton
            event={event}
            identifier={spellbook.slug}
            size="sm"
            className="bg-background"
          />
        </div>
      </div>

      {/* Event Kinds */}
      {getSpellbookKinds(spellbook).length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Event Kinds
          </h3>
          <div className="flex flex-wrap gap-2">
            {getSpellbookKinds(spellbook).map((kind) => (
              <KindBadge key={kind} kind={kind} showName clickable />
            ))}
          </div>
        </div>
      )}

      {/* Tabs Summary */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Layout className="size-4" />
          Tabs
        </h3>

        <div className="grid gap-4 grid-cols-1">
          {sortedWorkspaces.map((ws) => {
            return (
              <div
                key={ws.id}
                className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card/50"
              >
                {ws.label && (
                  <span className="font-bold text-sm">
                    {ws.label}
                  </span>
                )}

                {ws.layout && (
                  <LayoutVisualizer
                    layout={ws.layout}
                    windows={spellbook.content.windows}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Share Dialog */}
      <ShareSpellbookDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        event={event}
        spellbook={spellbook}
      />
    </div>
  );
}
