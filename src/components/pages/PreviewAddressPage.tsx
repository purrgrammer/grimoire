import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { nip19 } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier) {
      setError("No identifier provided");
      return;
    }

    // Reconstruct the full identifier
    const fullIdentifier = `naddr${identifier}`;

    try {
      const decoded = nip19.decode(fullIdentifier);

      if (decoded.type !== "naddr") {
        setError(`Invalid identifier type: expected naddr, got ${decoded.type}`);
        toast.error("Invalid naddr identifier");
        return;
      }

      const pointer = decoded.data as AddressPointer;

      // Check if it's a spellbook (kind 30777)
      if (pointer.kind === 30777) {
        // Redirect to the spellbook route
        const npub = nip19.npubEncode(pointer.pubkey);
        navigate(`/${npub}/${pointer.identifier}`, { replace: true });
      } else {
        // For other kinds, we could extend this to handle them differently
        // For now, show an error
        setError(
          `Addressable events of kind ${pointer.kind} are not yet supported in preview mode`
        );
        toast.error("Unsupported event kind");
      }
    } catch (e) {
      console.error("Failed to decode naddr:", e);
      setError(e instanceof Error ? e.message : "Failed to decode identifier");
      toast.error("Invalid naddr identifier");
    }
  }, [identifier, navigate]);

  // Loading/error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-md">
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
