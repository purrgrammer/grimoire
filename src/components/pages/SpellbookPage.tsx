import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useProfile } from "@/hooks/useProfile";
import { resolveNip05, isNip05 } from "@/lib/nip05";
import { parseSpellbook } from "@/lib/spellbook-manager";
import { SpellbookEvent } from "@/types/spell";
import { nip19 } from "nostr-tools";
import { toast } from "sonner";
import { Loader2, BookHeart, Link as LinkIcon, X, Check } from "lucide-react";
import { Button } from "../ui/button";
import { WorkspaceView } from "../WorkspaceView";

export default function SpellbookPage() {
  const {
    switchToTemporary,
    applyTemporaryToPersistent,
    discardTemporary,
    isTemporary,
  } = useGrimoire();
  const { actor, identifier } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [hasLoadedSpellbook, setHasLoadedSpellbook] = useState(false);

  // Determine if we should show the preview banner
  // In SpellbookPage, we always show it if we have loaded a spellbook temporarily
  const showBanner = isTemporary && hasLoadedSpellbook;

  // 1. Resolve actor to pubkey
  useEffect(() => {
    if (!actor) {
        // Should not happen in this route, but safe guard
      return;
    }

    const resolve = async () => {
      setIsResolving(true);
      setResolutionError(null);

      try {
        if (actor.startsWith("npub")) {
          const { data } = nip19.decode(actor);
          setResolvedPubkey(data as string);
        } else if (isNip05(actor)) {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("NIP-05 resolution timeout")),
              10000,
            ),
          );
          const pubkey = await Promise.race([
            resolveNip05(actor),
            timeoutPromise,
          ]);
          setResolvedPubkey(pubkey);
        } else if (actor.length === 64) {
          setResolvedPubkey(actor);
        } else {
          setResolutionError(`Invalid actor format: ${actor}`);
        }
      } catch (e) {
        console.error("Failed to resolve actor:", actor, e);
        setResolutionError(
          e instanceof Error ? e.message : "Failed to resolve actor",
        );
        toast.error(`Failed to resolve actor: ${actor}`);
      } finally {
        setIsResolving(false);
      }
    };

    resolve();
  }, [actor]);

  // 2. Fetch the spellbook event
  const pointer = useMemo(() => {
    if (!resolvedPubkey || !identifier) return undefined;
    return {
      kind: 30777,
      pubkey: resolvedPubkey,
      identifier: identifier,
    };
  }, [resolvedPubkey, identifier]);

  const spellbookEvent = useNostrEvent(pointer);
  const authorProfile = useProfile(resolvedPubkey || undefined);

  // 3. Load spellbook when event is available
  useEffect(() => {
    if (spellbookEvent && !hasLoadedSpellbook) {
      try {
        const parsed = parseSpellbook(spellbookEvent as SpellbookEvent);
        switchToTemporary(parsed);
        setHasLoadedSpellbook(true);
        
        const isPreviewPath = location.pathname.startsWith("/preview/");
        if (isPreviewPath) {
             toast.info(`Previewing spellbook: ${parsed.title}`, {
            description:
              "You are in a temporary session. Apply to keep this spellbook.",
          });
        }
       
      } catch (e) {
        console.error("Failed to parse spellbook:", e);
        toast.error("Failed to load spellbook");
      }
    }
  }, [spellbookEvent, hasLoadedSpellbook, switchToTemporary, location.pathname]);

  // Cleanup when leaving the page (unmounting)
  // But wait, if we navigate to /, we want to discard.
  // If we apply, we navigate to / but we applied first.
  useEffect(() => {
      return () => {
          // If we are unmounting and still temporary, check if we need to cleanup?
          // Actually, AppShell wraps this. If we navigate to /, DashboardPage mounts.
          // DashboardPage doesn't enforce cleanup.
          // So we should cleanup here if we leave this route without applying.
          
          // Ideally, we'd check if we are navigating to "Apply". 
          // But applyTemporaryToPersistent clears temporary state internally? 
          // No, it just merges it. 
          
          // Let's look at `useGrimoire`:
          // applyTemporaryToPersistent -> dispatch({ type: "APPLY_TEMP" }) -> sets grimoireStateAtom = temp, internalTemporaryStateAtom = null.
          
          // So if we applied, isTemporary is false.
          // If we navigate away without applying, isTemporary is true.
          // But we can't easily check "isTemporary" in cleanup function because of closure staleness?
          // Use a ref or rely on the next component to not show temporary state?
          // Actually, the global state holds the temporary state.
          // If the user clicks "Home", they expect their old state.
          
          // The previous logic in Home.tsx was:
          // useEffect(() => { if (!actor && isTemporary) discardTemporary() }, [actor, isTemporary])
          
          // Since we are unmounting SpellbookPage, we are going somewhere else.
          // If that somewhere else is NOT a spellbook page, we might want to discard.
          // But maybe we want to keep it if we navigate to "Settings" (modal) or something? 
          // But those are likely overlays.
          
          // For now, let's rely on the user explicitly discarding or applying via the banner,
          // OR implement the "Guard" in DashboardPage to discard if it finds itself in temporary mode?
          // Or just discard on unmount if we didn't apply?
          // That's hard to track.
          
          // Let's implement the cleanup in DashboardPage!
          // If DashboardPage mounts and isTemporary is true, it means we navigated back home.
          // But wait, what if we "Applied"? Then isTemporary is false.
          // So if DashboardPage mounts and isTemporary is TRUE, we should discard?
          // Yes, that replicates the Home.tsx logic: "if (!actor) ... discard".
      };
  }, []);

  const handleApplySpellbook = () => {
    applyTemporaryToPersistent();
    navigate("/", { replace: true });
    toast.success("Spellbook applied to your dashboard");
  };

  const handleDiscardPreview = () => {
    discardTemporary();
    navigate("/", { replace: true });
  };

  const handleCopyLink = () => {
    if (!actor || !identifier) return;
    const link = `${window.location.origin}/preview/${actor}/${identifier}`;
    navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard");
  };
  
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff < 24 * 60 * 60 * 1000) {
      const hours = Math.floor(diff / (60 * 60 * 1000));
      if (hours === 0) {
        const minutes = Math.floor(diff / (60 * 1000));
        return minutes === 0 ? "just now" : `${minutes}m ago`;
      }
      return `${hours}h ago`;
    }
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="flex flex-col h-full relative">
       {/* Banner Layer */}
       {showBanner && (
          <div className="absolute top-0 left-0 right-0 bg-accent text-accent-foreground px-4 py-1.5 flex items-center justify-between text-sm font-medium animate-in slide-in-from-top duration-300 shadow-md z-50">
            <div className="flex items-center gap-3">
              <BookHeart className="size-4 flex-shrink-0" />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold">
                  {spellbookEvent?.tags.find((t) => t[0] === "title")?.[1] ||
                    "Spellbook"}
                </span>
                {spellbookEvent && (
                  <span className="text-xs text-accent-foreground/70 flex items-center gap-2">
                    {authorProfile?.name || resolvedPubkey?.slice(0, 8)}
                    <span className="text-accent-foreground/50">•</span>
                    {formatTimestamp(spellbookEvent.created_at)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-black/10 text-accent-foreground"
                onClick={handleCopyLink}
                title="Copy share link"
              >
                <LinkIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 hover:bg-black/10 text-accent-foreground font-bold"
                onClick={handleDiscardPreview}
              >
                <X className="size-3.5 mr-1" />
                Discard
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 bg-white text-accent hover:bg-white/90 font-bold shadow-sm"
                onClick={handleApplySpellbook}
              >
                <Check className="size-3.5 mr-1" />
                Apply Spellbook
              </Button>
            </div>
          </div>
        )}

      {/* Loading States */}
      {isResolving && (
         <div className="absolute top-0 left-0 right-0 z-40 bg-muted px-4 py-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>Resolving {actor}...</span>
          </div>
      )}
      {resolutionError && (
         <div className="absolute top-0 left-0 right-0 z-40 bg-destructive/10 text-destructive px-4 py-2 flex items-center justify-center text-sm">
            <span>Failed to resolve actor: {resolutionError}</span>
          </div>
      )}

      {/* Main Content */}
      <div className={showBanner ? "pt-12 h-full" : "h-full"}>
          <WorkspaceView />
      </div>
    </div>
  );
}
