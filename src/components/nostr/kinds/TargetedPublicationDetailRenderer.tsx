import { Target, Users, ExternalLink } from "lucide-react";
import { DetailKindRenderer } from "./index";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getTargetedPublicationEventId,
  getTargetedPublicationAddress,
  getTargetedPublicationKind,
  getTargetedCommunities,
} from "@/lib/communikeys-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { parseAddressPointer } from "@/lib/nip89-helpers";
import { getKindName } from "@/constants/kinds";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 30222 - Targeted Publication
 * Displays full targeted publication with communities and original content
 */
export function TargetedPublicationDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const { addWindow } = useGrimoire();

  // Get the original publication reference
  const eventId = getTargetedPublicationEventId(event);
  const eventAddress = getTargetedPublicationAddress(event);
  const publicationKind = getTargetedPublicationKind(event);

  // Build pointer for the original event
  let pointer: Parameters<typeof useNostrEvent>[0] = undefined;
  if (eventId) {
    pointer = { id: eventId };
  } else if (eventAddress) {
    const parsed = parseAddressPointer(eventAddress);
    if (parsed) {
      pointer = {
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
      };
    }
  }

  // Fetch the original publication
  const originalEvent = useNostrEvent(pointer, event);

  // Get targeted communities with relay hints
  const communities = getTargetedCommunities(event);

  // Open a community
  const openCommunity = (pubkey: string) => {
    addWindow("communikey", { pubkey });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-2">
          <Target className="size-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Targeted Publication</h1>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <span>
            {new Date(event.created_at * 1000).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
          {publicationKind && (
            <>
              <span>•</span>
              <Badge variant="outline">
                Original: {getKindName(publicationKind)}
              </Badge>
            </>
          )}
        </div>
      </header>

      {/* Targeted Communities */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="size-5" />
          Targeted Communities ({communities.length})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {communities.map((community) => (
            <CommunityCard
              key={community.pubkey}
              pubkey={community.pubkey}
              relay={community.relay}
              onOpen={() => openCommunity(community.pubkey)}
            />
          ))}
        </div>
      </section>

      {/* Original Publication */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Original Publication</h2>
        {originalEvent ? (
          <Card>
            <CardContent className="p-0">
              <DetailKindRenderer event={originalEvent} />
            </CardContent>
          </Card>
        ) : pointer ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col gap-4">
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                Loading original publication
                {publicationKind && ` (kind ${publicationKind})`}...
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              <p className="text-muted-foreground">
                Original publication reference not found
              </p>
              {eventId && (
                <p className="text-xs text-muted-foreground mt-2">
                  Event ID: <code>{eventId}</code>
                </p>
              )}
              {eventAddress && (
                <p className="text-xs text-muted-foreground mt-2">
                  Address: <code>{eventAddress}</code>
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

/**
 * Card component for displaying a targeted community
 */
function CommunityCard({
  pubkey,
  relay,
  onOpen,
}: {
  pubkey: string;
  relay?: string;
  onOpen: () => void;
}) {
  const profile = useProfile(pubkey);
  const displayName = getDisplayName(pubkey, profile);

  return (
    <Card className="hover:bg-muted/50 transition-colors">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            {profile?.picture ? (
              <img
                src={profile.picture}
                alt={displayName}
                className="size-8 rounded-full object-cover"
              />
            ) : (
              <div className="size-8 rounded-full bg-muted flex items-center justify-center">
                <Users className="size-4 text-muted-foreground" />
              </div>
            )}
            <span className="truncate">{displayName}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onOpen}>
            <ExternalLink className="size-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="text-xs text-muted-foreground truncate">
          <UserName pubkey={pubkey} className="text-xs" />
        </p>
        {relay && (
          <p className="text-xs text-muted-foreground mt-1 truncate">
            Relay: {relay}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
