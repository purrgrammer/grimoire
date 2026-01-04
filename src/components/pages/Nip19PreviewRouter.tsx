import { useParams } from "react-router";
import PreviewProfilePage from "./PreviewProfilePage";
import PreviewEventPage from "./PreviewEventPage";
import PreviewAddressPage from "./PreviewAddressPage";

/**
 * Nip19PreviewRouter - Routes to the appropriate preview component based on NIP-19 identifier type
 * Handles npub, note, nevent, and naddr identifiers
 */
export default function Nip19PreviewRouter() {
  const { identifier } = useParams<{ identifier: string }>();

  if (!identifier) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No identifier provided</p>
      </div>
    );
  }

  // Route based on identifier prefix
  if (identifier.startsWith("npub1")) {
    return <PreviewProfilePage />;
  } else if (identifier.startsWith("nevent1")) {
    return <PreviewEventPage />;
  } else if (identifier.startsWith("note1")) {
    return <PreviewEventPage />;
  } else if (identifier.startsWith("naddr1")) {
    return <PreviewAddressPage />;
  }

  // Not a recognized NIP-19 identifier
  return null;
}
