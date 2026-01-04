import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
import { EventDetailViewer } from "../EventDetailViewer";
import { nip19 } from "nostr-tools";
import { toast } from "sonner";

/**
 * PreviewAddressPage - Preview or redirect naddr identifiers
 * Route: /naddr1*
 * For spellbooks (kind 30777), redirects to /:actor/:identifier
 * For all other addressable events, shows detail view
 */
export default function PreviewAddressPage() {
  const params = useParams<{ "*": string }>();
  const navigate = useNavigate();

  // Get the full naddr from the URL (naddr1 + captured part)
  const fullIdentifier = params["*"] ? `naddr1${params["*"]}` : undefined;

  // Decode the naddr identifier (synchronous, memoized)
  const { decoded, error } = useNip19Decode(fullIdentifier, "naddr");

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
  return (
    <div className="h-full overflow-auto">
      <EventDetailViewer pointer={decoded.data} />
    </div>
  );
}
