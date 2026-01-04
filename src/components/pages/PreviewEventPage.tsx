import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { nip19 } from "nostr-tools";
import type { EventPointer } from "nostr-tools/nip19";
import { EventDetailViewer } from "../EventDetailViewer";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * PreviewEventPage - Preview a Nostr event from a nevent or note identifier
 * Routes: /nevent..., /note...
 * This page shows a single event view without affecting user's workspace layout
 */
export default function PreviewEventPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();
  const [pointer, setPointer] = useState<EventPointer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!identifier) {
      setError("No identifier provided");
      return;
    }

    // Determine the prefix based on the current path
    const path = window.location.pathname;
    let fullIdentifier: string;

    if (path.startsWith("/nevent")) {
      fullIdentifier = `nevent${identifier}`;
    } else if (path.startsWith("/note")) {
      fullIdentifier = `note${identifier}`;
    } else {
      setError("Invalid route");
      return;
    }

    try {
      const decoded = nip19.decode(fullIdentifier);

      if (decoded.type === "nevent") {
        setPointer(decoded.data);
      } else if (decoded.type === "note") {
        // note is just an event ID, convert to EventPointer
        setPointer({
          id: decoded.data,
        });
      } else {
        setError(`Invalid identifier type: expected nevent or note, got ${decoded.type}`);
        toast.error("Invalid event identifier");
        return;
      }
    } catch (e) {
      console.error("Failed to decode event identifier:", e);
      setError(e instanceof Error ? e.message : "Failed to decode identifier");
      toast.error("Invalid event identifier");
    }
  }, [identifier]);

  // Loading state
  if (!pointer && !error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary/50" />
        <div className="flex flex-col items-center gap-1">
          <p className="font-medium text-foreground">Loading Event...</p>
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
      <EventDetailViewer pointer={pointer!} />
    </div>
  );
}
