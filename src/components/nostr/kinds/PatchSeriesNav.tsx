import { useMemo } from "react";
import { Layers, ChevronRight } from "lucide-react";
import { getNip10References } from "applesauce-common/helpers/threading";
import { useTimeline } from "@/hooks/useTimeline";
import { useGrimoire } from "@/core/state";
import { getPatchSubject, isPatchRoot } from "@/lib/nip34-helpers";
import { formatTimestamp } from "@/hooks/useLocale";
import type { NostrEvent } from "@/types/nostr";

interface PatchSeriesNavProps {
  event: NostrEvent;
  relays: string[];
}

/**
 * Patch series navigation component for the PatchDetailRenderer.
 *
 * NIP-34 patches form a series via NIP-10 threading:
 * - The first patch is tagged ["t", "root"]
 * - Subsequent patches include ["e", rootPatchId, relay, "root"]
 *
 * This component finds the root patch, then queries all patches
 * that reference the same root to build a navigable series list.
 */
export function PatchSeriesNav({ event, relays }: PatchSeriesNavProps) {
  const { addWindow } = useGrimoire();
  const isRoot = isPatchRoot(event);

  // Parse NIP-10 references to find the root patch
  const refs = getNip10References(event);
  const rootPointer = refs.root?.e;
  const rootEventId = rootPointer?.id;

  // The effective root ID: if this IS the root patch, use its own ID;
  // otherwise use the referenced root
  const seriesRootId = isRoot ? event.id : rootEventId;

  // Query all kind 1617 patches that reference the same root
  const seriesFilter = useMemo(() => {
    if (!seriesRootId) return null;
    return {
      kinds: [1617],
      "#e": [seriesRootId],
    };
  }, [seriesRootId]);

  const { events: relatedPatches } = useTimeline(
    seriesRootId ? `patch-series-${seriesRootId}` : "patch-series-noop",
    seriesFilter ?? { kinds: [1617], "#e": ["noop"] },
    seriesFilter ? relays : [],
    { limit: 50 },
  );

  // Build sorted series: root first, then related patches by created_at
  const series = useMemo(() => {
    if (!seriesRootId) return [];

    // Collect all patches in the series
    const patches: NostrEvent[] = [];

    // If this is the root, include it; relatedPatches are the children
    if (isRoot) {
      patches.push(event);
      patches.push(...relatedPatches.filter((p) => p.id !== event.id));
    } else {
      // Include related patches (which reference the root)
      patches.push(...relatedPatches.filter((p) => p.id !== event.id));
    }

    // Sort by created_at ascending (oldest first = series order)
    patches.sort((a, b) => a.created_at - b.created_at);

    return patches;
  }, [seriesRootId, isRoot, event, relatedPatches]);

  // Don't show if there are no related patches
  if (series.length === 0) return null;

  const handlePatchClick = (patchEvent: NostrEvent) => {
    addWindow(
      "open",
      { id: patchEvent.id },
      getPatchSubject(patchEvent) || "Patch",
    );
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
        <Layers className="size-3.5" />
        Patch Series ({series.length + (isRoot ? 0 : 1)})
      </h2>

      <div className="flex flex-col border border-border rounded overflow-hidden">
        {/* Root patch indicator (if we're not the root and have a rootEventId) */}
        {!isRoot && rootEventId && (
          <button
            onClick={() => addWindow("open", { id: rootEventId }, "Root Patch")}
            className="flex items-center gap-2 px-3 py-2 text-xs bg-accent/10 text-accent hover:bg-accent/20 transition-colors text-left"
          >
            <ChevronRight className="size-3 flex-shrink-0" />
            <span className="font-semibold">Root Patch</span>
          </button>
        )}

        {/* Series patches */}
        {series.map((patch, idx) => {
          const isCurrent = patch.id === event.id;
          const subject = getPatchSubject(patch) || `Patch ${idx + 1}`;

          return (
            <button
              key={patch.id}
              onClick={() => !isCurrent && handlePatchClick(patch)}
              disabled={isCurrent}
              className={`flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-t border-border first:border-t-0 ${
                isCurrent
                  ? "bg-primary/10 text-primary font-semibold cursor-default"
                  : "hover:bg-muted/50 text-foreground cursor-crosshair"
              }`}
            >
              <span className="text-muted-foreground flex-shrink-0 w-5 text-right">
                {idx + 1}.
              </span>
              <span className="truncate flex-1">{subject}</span>
              <span className="text-muted-foreground flex-shrink-0">
                {formatTimestamp(patch.created_at, "relative")}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
