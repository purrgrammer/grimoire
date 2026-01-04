import { useMemo, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
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
  const location = useLocation();

  // Determine the prefix based on the current path
  const fullIdentifier = useMemo(() => {
    if (!identifier) return undefined;

    const path = location.pathname;
    if (path.startsWith("/nevent")) {
      return `nevent${identifier}`;
    } else if (path.startsWith("/note")) {
      return `note${identifier}`;
    }
    return undefined;
  }, [identifier, location.pathname]);

  // Decode the event identifier (accepts both nevent and note)
  const { decoded, isLoading, error, retry } = useNip19Decode(fullIdentifier);

  // Convert decoded entity to EventPointer
  const pointer: EventPointer | null = useMemo(() => {
    if (!decoded) return null;

    if (decoded.type === "nevent") {
      return decoded.data;
    } else if (decoded.type === "note") {
      // note is just an event ID, convert to EventPointer
      return { id: decoded.data };
    }
    return null;
  }, [decoded]);

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error("Invalid event identifier");
    }
  }, [error]);

  // Validate that we got an event-type entity
  useEffect(() => {
    if (decoded && decoded.type !== "nevent" && decoded.type !== "note") {
      toast.error(`Invalid identifier type: expected nevent or note, got ${decoded.type}`);
    }
  }, [decoded]);

  // Loading state
  if (isLoading) {
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
  if (error || !pointer) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-md max-w-md text-center">
          {error || "Failed to decode event identifier"}
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

  return (
    <div className="h-full overflow-auto">
      <EventDetailViewer pointer={pointer} />
    </div>
  );
}
