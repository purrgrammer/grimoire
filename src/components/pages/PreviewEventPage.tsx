import { useMemo, useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { useNip19Decode } from "@/hooks/useNip19Decode";
import type { EventPointer } from "nostr-tools/nip19";
import { PreviewDetail } from "./PreviewDetail";
import { toast } from "sonner";
import { useRevealOnOpen } from "@/hooks/useRevealOnOpen";
import { eventPreviewWindow } from "@/lib/standalone-window";

/**
 * PreviewEventPage - Preview a Nostr event from a nevent or note identifier
 * Route: /:identifier (where identifier starts with nevent1 or note1)
 * This page shows a single event view without affecting user's workspace layout.
 * Opening another window from it moves the event into the workspace beside the
 * new one and shows the dashboard (`useRevealOnOpen`).
 */
export default function PreviewEventPage() {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();

  // Decode the event identifier (synchronous, memoized)
  const { decoded, error } = useNip19Decode(identifier);

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

  // The window this page is showing, as the workspace would hold it.
  const previewWindow = useMemo(
    () =>
      identifier && pointer ? eventPreviewWindow(identifier, pointer) : null,
    [identifier, pointer],
  );
  useRevealOnOpen(previewWindow, "active-workspace");

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error("Invalid event identifier");
    }
  }, [error]);

  // Validate that we got an event-type entity
  useEffect(() => {
    if (decoded && decoded.type !== "nevent" && decoded.type !== "note") {
      toast.error(
        `Invalid identifier type: expected nevent or note, got ${decoded.type}`,
      );
    }
  }, [decoded]);

  // Error state
  if (error || !pointer) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-md max-w-md text-center">
          {error || "Failed to decode event identifier"}
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

  return <PreviewDetail pointer={pointer} />;
}
