import { useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
import { PreviewDetail } from "./PreviewDetail";
import { nip19 } from "nostr-tools";
import { toast } from "sonner";
import { useRevealOnOpen } from "@/hooks/useRevealOnOpen";
import { eventPreviewWindow } from "@/lib/standalone-window";

/**
 * PreviewAddressPage - Preview or redirect naddr identifiers
 * Route: /:identifier (where identifier starts with naddr1)
 * For spellbooks (kind 30777), redirects to /:actor/:identifier
 * For all other addressable events, shows detail view; opening another window
 * from it moves the event into the workspace beside the new one and shows the
 * dashboard (`useRevealOnOpen`).
 */
export default function PreviewAddressPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();

  // Decode the naddr identifier (synchronous, memoized)
  const { decoded, error } = useNip19Decode(identifier, "naddr");

  // The window this page is showing, as the workspace would hold it. None for
  // a spellbook, which redirects to a route that renders the workspace.
  const previewWindow = useMemo(
    () =>
      identifier && decoded?.type === "naddr" && decoded.data.kind !== 30777
        ? eventPreviewWindow(identifier, decoded.data)
        : null,
    [identifier, decoded],
  );
  useRevealOnOpen(previewWindow);

  // Handle redirect for spellbooks
  useEffect(() => {
    if (!decoded || decoded.type !== "naddr") return;

    const pointer = decoded.data;

    // Check if it's a spellbook (kind 30777) - redirect to spellbook route
    if (pointer.kind === 30777) {
      const npub = nip19.npubEncode(pointer.pubkey);
      navigate(`/${npub}/${pointer.identifier}`, { replace: true });
    }
  }, [decoded, navigate]);

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error("Invalid naddr identifier");
    }
  }, [error]);

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-md max-w-md text-center">
          {error}
        </div>
        <button
          onClick={() => navigate("/")}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          Return to dashboard
        </button>
      </div>
    );
  }

  // Type guard to ensure we have the correct decoded type
  if (!decoded || decoded.type !== "naddr") {
    return null;
  }

  // If it's a spellbook, return null (redirect will happen in useEffect)
  if (decoded.data.kind === 30777) {
    return null;
  }

  // Show detail view for all other addressable events
  return <PreviewDetail pointer={decoded.data} />;
}
