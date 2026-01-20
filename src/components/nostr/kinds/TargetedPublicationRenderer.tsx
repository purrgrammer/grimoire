import type { NostrEvent } from "@/types/nostr";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getTargetedPublicationEventId,
  getTargetedPublicationAddress,
  getTargetedPublicationKind,
  getTargetedCommunities,
} from "@/lib/communikeys-helpers";
import { BaseEventContainer } from "./BaseEventRenderer";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { Share2, Users2, FileText, ExternalLink } from "lucide-react";
import { KindRenderer } from "./index";

interface TargetedPublicationRendererProps {
  event: NostrEvent;
}

/**
 * Renderer for Targeted Publication events (kind 30222)
 * Shows the publication being shared to communities
 */
export function TargetedPublicationRenderer({
  event,
}: TargetedPublicationRendererProps) {
  const { addWindow } = useGrimoire();

  // Get the original publication reference
  const eventId = getTargetedPublicationEventId(event);
  const address = getTargetedPublicationAddress(event);
  const originalKind = getTargetedPublicationKind(event);
  const targetedCommunities = getTargetedCommunities(event);

  // Create pointer for the original event
  const pointer = eventId
    ? { id: eventId }
    : address
      ? (() => {
          const [kind, pubkey, identifier] = address.split(":");
          return {
            kind: parseInt(kind, 10),
            pubkey,
            identifier,
          };
        })()
      : undefined;

  // Fetch the original publication
  const originalEvent = useNostrEvent(pointer);

  const handleOpenOriginal = () => {
    if (pointer) {
      addWindow("open", { pointer });
    }
  };

  const handleOpenCommunity = (pubkey: string, relays?: string[]) => {
    addWindow("community", { pubkey, relays });
  };

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Share2 className="size-4" />
          <span>Shared to {targetedCommunities.length} communities</span>
        </div>

        {/* Target Communities */}
        <div className="flex flex-wrap gap-2">
          {targetedCommunities.map((community, idx) => (
            <CommunityChip
              key={idx}
              pubkey={community.pubkey}
              relay={community.relay}
              onClick={() =>
                handleOpenCommunity(
                  community.pubkey,
                  community.relay ? [community.relay] : undefined,
                )
              }
            />
          ))}
        </div>

        {/* Original Publication Preview */}
        {originalEvent ? (
          <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
            <KindRenderer event={originalEvent} depth={1} />
          </div>
        ) : pointer ? (
          <div className="border border-border rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" />
              <span>
                {originalKind ? `Kind ${originalKind}` : "Loading..."}
              </span>
            </div>
            <button
              onClick={handleOpenOriginal}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="size-3" />
              View
            </button>
          </div>
        ) : null}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Small chip component for displaying a target community
 */
function CommunityChip({
  pubkey,
  relay,
  onClick,
}: {
  pubkey: string;
  relay?: string;
  onClick: () => void;
}) {
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded-full transition-colors"
      title={relay ? `via ${relay}` : undefined}
    >
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt={displayName}
          className="size-4 rounded-full object-cover"
        />
      ) : (
        <Users2 className="size-3.5 text-muted-foreground" />
      )}
      <span className="font-medium truncate max-w-[120px]">{displayName}</span>
    </button>
  );
}

/**
 * Detail renderer for Targeted Publication events (kind 30222)
 */
export function TargetedPublicationDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const { addWindow } = useGrimoire();

  // Get the original publication reference
  const eventId = getTargetedPublicationEventId(event);
  const address = getTargetedPublicationAddress(event);
  const originalKind = getTargetedPublicationKind(event);
  const targetedCommunities = getTargetedCommunities(event);

  // Create pointer for the original event
  const pointer = eventId
    ? { id: eventId }
    : address
      ? (() => {
          const [kind, pubkey, identifier] = address.split(":");
          return {
            kind: parseInt(kind, 10),
            pubkey,
            identifier,
          };
        })()
      : undefined;

  // Fetch the original publication
  const originalEvent = useNostrEvent(pointer);

  const handleOpenOriginal = () => {
    if (pointer) {
      addWindow("open", { pointer });
    }
  };

  const handleOpenCommunity = (pubkey: string, relays?: string[]) => {
    addWindow("community", { pubkey, relays });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Share2 className="size-6" />
          Targeted Publication
        </h1>
        <p className="text-muted-foreground">
          Published by <UserName pubkey={event.pubkey} />
        </p>
      </div>

      {/* Target Communities */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users2 className="size-5" />
          Target Communities ({targetedCommunities.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {targetedCommunities.map((community, idx) => (
            <CommunityTargetCard
              key={idx}
              pubkey={community.pubkey}
              relay={community.relay}
              onClick={() =>
                handleOpenCommunity(
                  community.pubkey,
                  community.relay ? [community.relay] : undefined,
                )
              }
            />
          ))}
        </div>
      </div>

      {/* Original Publication */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="size-5" />
            Original Publication
          </h2>
          {pointer && (
            <button
              onClick={handleOpenOriginal}
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <ExternalLink className="size-4" />
              Open in new window
            </button>
          )}
        </div>

        {originalEvent ? (
          <div className="border border-border rounded-lg overflow-hidden">
            <KindRenderer event={originalEvent} depth={0} />
          </div>
        ) : (
          <div className="border border-border rounded-lg p-4 text-center text-muted-foreground">
            {originalKind
              ? `Loading kind ${originalKind} event...`
              : "Loading..."}
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {eventId && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Referenced Event ID</h3>
            <code className="font-mono text-xs truncate">{eventId}</code>
          </div>
        )}
        {address && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Referenced Address</h3>
            <code className="font-mono text-xs truncate">{address}</code>
          </div>
        )}
        {originalKind !== undefined && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Original Kind</h3>
            <span>{originalKind}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Card component for displaying a target community in detail view
 */
function CommunityTargetCard({
  pubkey,
  relay,
  onClick,
}: {
  pubkey: string;
  relay?: string;
  onClick: () => void;
}) {
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors text-left"
    >
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt={displayName}
          className="size-10 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="size-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Users2 className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="font-semibold truncate">{displayName}</span>
        {relay && (
          <span className="text-xs text-muted-foreground truncate">
            via {relay}
          </span>
        )}
      </div>
      <ExternalLink className="size-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}
