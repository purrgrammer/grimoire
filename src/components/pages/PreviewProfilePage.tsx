import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { nip19 } from "nostr-tools";
import { ProfileViewer } from "../ProfileViewer";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * PreviewProfilePage - Preview a Nostr profile from an npub identifier
 * Route: /npub...
 * This page shows a single profile view without affecting user's workspace layout
 */
export default function PreviewProfilePage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier) {
      setError("No identifier provided");
      return;
    }

    // Reconstruct the full identifier (react-router splits on /)
    const fullIdentifier = `npub${identifier}`;

    try {
      const decoded = nip19.decode(fullIdentifier);
      if (decoded.type !== "npub") {
        setError(`Invalid identifier type: expected npub, got ${decoded.type}`);
        toast.error("Invalid npub identifier");
        return;
      }

      setPubkey(decoded.data);
    } catch (e) {
      console.error("Failed to decode npub:", e);
      setError(e instanceof Error ? e.message : "Failed to decode identifier");
      toast.error("Invalid npub identifier");
    }
  }, [identifier]);

  // Loading state
  if (!pubkey && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary/50" />
        <div className="flex flex-col items-center gap-1">
          <p className="font-medium text-foreground">Loading Profile...</p>
          <p className="text-xs">Decoding identifier</p>
        </div>
      </div>
    );
  }

  // Error state
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
    <div className="h-full overflow-auto">
      <ProfileViewer pubkey={pubkey!} />
    </div>
  );
}
