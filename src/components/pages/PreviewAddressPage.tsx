import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
import { nip19 } from "nostr-tools";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * PreviewAddressPage - Redirect naddr identifiers to appropriate routes
 * Route: /naddr...
 * For spellbooks (kind 30777), redirects to /:actor/:identifier
 * For other kinds, shows error (could be extended to handle other addressable events)
 */
export default function PreviewAddressPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();

  // Reconstruct the full identifier
  const fullIdentifier = identifier ? `naddr${identifier}` : undefined;

  // Decode the naddr identifier
  const { decoded, isLoading, error, retry } = useNip19Decode(
    fullIdentifier,
    "naddr"
  );

  // Handle redirect when decoded successfully
  useEffect(() => {
    if (!decoded || decoded.type !== "naddr") return;

    const pointer = decoded.data;

    // Check if it's a spellbook (kind 30777)
    if (pointer.kind === 30777) {
      // Redirect to the spellbook route
      const npub = nip19.npubEncode(pointer.pubkey);
      navigate(`/${npub}/${pointer.identifier}`, { replace: true });
    } else {
      // For other kinds, we could extend this to handle them differently
      // For now, show an error via toast
      toast.error(`Addressable events of kind ${pointer.kind} are not yet supported in preview mode`);
    }
  }, [decoded, navigate]);

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error("Invalid naddr identifier");
    }
  }, [error]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary/50" />
        <div className="flex flex-col items-center gap-1">
          <p className="font-medium text-foreground">Redirecting...</p>
          <p className="text-xs">Processing address pointer</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-md max-w-md text-center">
          {error}
        </div>
        <div className="flex gap-3">
          <button
            onClick={retry}
            className="text-sm text-primary hover:text-primary/80 underline"
          >
            Retry
          </button>
          <button
            onClick={() => navigate("/")}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Return to dashboard
          </button>
        </div>
      </div>
    );
  }

  // Show error for unsupported kinds
  if (decoded && decoded.type === "naddr" && decoded.data.kind !== 30777) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-md max-w-md text-center">
          Addressable events of kind {decoded.data.kind} are not yet supported in preview mode
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

  // Still processing redirect
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
      <Loader2 className="size-8 animate-spin text-primary/50" />
      <div className="flex flex-col items-center gap-1">
        <p className="font-medium text-foreground">Redirecting...</p>
        <p className="text-xs">Processing address pointer</p>
      </div>
    </div>
  );
}
