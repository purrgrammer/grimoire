import { useParams, useNavigate } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
import { ProfileViewer } from "../ProfileViewer";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * PreviewProfilePage - Preview a Nostr profile from an npub identifier
 * Route: /:identifier (where identifier starts with npub1)
 * This page shows a single profile view without affecting user's workspace layout
 */
export default function PreviewProfilePage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();

  // Decode the npub identifier (synchronous, memoized)
  const { decoded, error } = useNip19Decode(identifier, "npub");

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error("Invalid npub identifier");
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
  if (!decoded || decoded.type !== "npub") {
    return null;
  }

  return (
    <div className="h-full overflow-auto">
      <ProfileViewer pubkey={decoded.data} />
    </div>
  );
}
