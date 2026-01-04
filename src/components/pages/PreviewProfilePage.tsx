import { useParams, useNavigate } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
import { ProfileViewer } from "../ProfileViewer";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";

/**
 * PreviewProfilePage - Preview a Nostr profile from an npub identifier
 * Route: /npub...
 * This page shows a single profile view without affecting user's workspace layout
 */
export default function PreviewProfilePage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();

  // Reconstruct the full identifier (react-router splits on /)
  const fullIdentifier = identifier ? `npub${identifier}` : undefined;

  // Decode the npub identifier
  const { decoded, isLoading, error, retry } = useNip19Decode(
    fullIdentifier,
    "npub"
  );

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error("Invalid npub identifier");
    }
  }, [error]);

  // Loading state
  if (isLoading) {
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

  // Type guard to ensure we have the correct decoded type
  if (!decoded || decoded.type !== "npub") {
    return null;
  }

  return (
    <div className="h-full overflow-auto">
      <ProfileViewer pubkey={decoded.data} />
    </div>
  );
}
