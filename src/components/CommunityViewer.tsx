import { useEffect } from "react";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { UserName } from "./nostr/UserName";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { addressLoader } from "@/services/loaders";
import { nip19 } from "nostr-tools";
import {
  getCommunityRelays,
  getCommunityDescription,
  getCommunityContentSections,
  getCommunityBlossomServers,
  getCommunityMints,
  getCommunityLocation,
  getCommunityGeohash,
  getCommunityTos,
  getCommunityBadgeRequirements,
  type ContentSection,
} from "@/lib/communikeys-helpers";
import {
  Users2,
  Server,
  MapPin,
  Layers,
  Award,
  FileText,
  Flower2,
  Coins,
  Copy,
  CopyCheck,
  ExternalLink,
  MessageSquare,
  Search,
  Loader2,
} from "lucide-react";
import type { Subscription } from "rxjs";

export interface CommunityViewerProps {
  pubkey: string;
  relays?: string[];
}

// Kind number for Communikeys Community event
const COMMUNIKEY_KIND = 10222;

/**
 * Content Section Card Component for displaying content sections
 */
function ContentSectionCard({
  section,
  communityPubkey,
}: {
  section: ContentSection;
  communityPubkey: string;
}) {
  const { addWindow } = useGrimoire();

  const handleQueryKind = (kind: number) => {
    // Open a REQ window to query this kind for the community
    addWindow("req", {
      filter: {
        kinds: [kind],
        "#h": [communityPubkey],
        limit: 50,
      },
    });
  };

  return (
    <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
      <h3 className="font-semibold text-base flex items-center gap-2">
        <Layers className="size-4 text-muted-foreground" />
        {section.name}
      </h3>

      {/* Event Kinds */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Content Types</span>
        <div className="flex flex-wrap gap-1">
          {section.kinds.map((kind) => (
            <button
              key={kind}
              onClick={() => handleQueryKind(kind)}
              className="px-2 py-0.5 text-xs bg-muted hover:bg-muted/80 rounded font-mono transition-colors flex items-center gap-1"
              title={`Query kind ${kind} events`}
            >
              {kind}
              <Search className="size-2.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Badge Requirements */}
      {section.badgePointers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Award className="size-3" />
            Required Badges
          </span>
          <div className="flex flex-col gap-1">
            {section.badgePointers.map((pointer, idx) => (
              <code
                key={idx}
                className="text-xs bg-muted rounded p-1 font-mono truncate"
                title={pointer}
              >
                {pointer.length > 50
                  ? `${pointer.slice(0, 25)}...${pointer.slice(-20)}`
                  : pointer}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CommunityViewer - Detailed view for a Communikeys community (kind 10222)
 * Shows community information derived from profile + kind 10222 event
 */
export function CommunityViewer({ pubkey, relays }: CommunityViewerProps) {
  const { state, addWindow } = useGrimoire();
  const accountPubkey = state.activeAccount?.pubkey;
  const eventStore = useEventStore();
  const { copy, copied } = useCopy();

  // Resolve $me alias
  const resolvedPubkey = pubkey === "$me" ? accountPubkey : pubkey;

  // Fetch profile metadata (community name, picture, etc.)
  const profile = useProfile(resolvedPubkey);
  const displayName = getDisplayName(resolvedPubkey ?? "", profile);

  // Fetch kind 10222 community event
  useEffect(() => {
    let subscription: Subscription | null = null;
    if (!resolvedPubkey) return;

    // Fetch the community event from network
    subscription = addressLoader({
      kind: COMMUNIKEY_KIND,
      pubkey: resolvedPubkey,
      identifier: "",
      relays,
    }).subscribe({
      error: (err) => {
        console.debug(
          `[CommunityViewer] Failed to fetch community event for ${resolvedPubkey.slice(0, 8)}:`,
          err,
        );
      },
    });

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [resolvedPubkey, eventStore, relays]);

  // Get community event (kind 10222) from EventStore
  const communityEvent = use$(
    () =>
      resolvedPubkey
        ? eventStore.replaceable(COMMUNIKEY_KIND, resolvedPubkey, "")
        : undefined,
    [eventStore, resolvedPubkey],
  );

  // Extract community metadata
  const communityRelays = communityEvent
    ? getCommunityRelays(communityEvent)
    : [];
  const description = communityEvent
    ? getCommunityDescription(communityEvent)
    : undefined;
  const contentSections = communityEvent
    ? getCommunityContentSections(communityEvent)
    : [];
  const blossomServers = communityEvent
    ? getCommunityBlossomServers(communityEvent)
    : [];
  const mints = communityEvent ? getCommunityMints(communityEvent) : [];
  const location = communityEvent
    ? getCommunityLocation(communityEvent)
    : undefined;
  const geohash = communityEvent
    ? getCommunityGeohash(communityEvent)
    : undefined;
  const tos = communityEvent ? getCommunityTos(communityEvent) : undefined;
  const badgeRequirements = communityEvent
    ? getCommunityBadgeRequirements(communityEvent)
    : [];

  // Generate npub for display
  const npub = resolvedPubkey ? nip19.npubEncode(resolvedPubkey) : "";

  const handleCopyNpub = () => {
    copy(npub);
  };

  const handleOpenProfile = () => {
    if (resolvedPubkey) {
      addWindow("profile", { pubkey: resolvedPubkey });
    }
  };

  const handleOpenChat = (kind: number) => {
    if (!resolvedPubkey) return;

    // For kind 9 (chat) or kind 11 (forum), we can query community content
    addWindow("req", {
      filter: {
        kinds: [kind],
        "#h": [resolvedPubkey],
        limit: 100,
      },
    });
  };

  const handleOpenRelayViewer = (url: string) => {
    addWindow("relay", { url });
  };

  // Handle $me alias without account
  if (pubkey === "$me" && !accountPubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="text-muted-foreground">
          <Users2 className="size-12 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">Account Required</h3>
          <p className="text-sm max-w-md">
            The <code className="bg-muted px-1.5 py-0.5">$me</code> alias
            requires an active account. Please log in to view your community.
          </p>
        </div>
      </div>
    );
  }

  if (!resolvedPubkey) {
    return (
      <div className="p-4 text-muted-foreground">Invalid community pubkey.</div>
    );
  }

  // Loading state
  if (!profile && !communityEvent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading community...</p>
      </div>
    );
  }

  // No community event found
  const noCommunityEvent = profile && !communityEvent;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        <button
          onClick={handleCopyNpub}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors truncate min-w-0"
          title={npub}
          aria-label="Copy community ID"
        >
          {copied ? (
            <CopyCheck className="size-3 flex-shrink-0" />
          ) : (
            <Copy className="size-3 flex-shrink-0" />
          )}
          <code className="truncate">
            {npub.slice(0, 16)}...{npub.slice(-8)}
          </code>
        </button>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Users2 className="size-3" />
            <span>Community</span>
          </div>

          {communityRelays.length > 0 && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Server className="size-3" />
              <span>{communityRelays.length}</span>
            </div>
          )}
        </div>
      </div>

      {/* Community Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {/* Header Section */}
          <div className="flex gap-4">
            {profile?.picture ? (
              <img
                src={profile.picture}
                alt={displayName}
                className="size-20 md:size-24 rounded-xl object-cover flex-shrink-0"
                loading="lazy"
              />
            ) : (
              <div className="size-20 md:size-24 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <Users2 className="size-10 text-muted-foreground" />
              </div>
            )}

            <div className="flex flex-col gap-2 flex-1 min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold">{displayName}</h1>
              {description && (
                <p className="text-muted-foreground text-sm md:text-base">
                  {description}
                </p>
              )}
              {location && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-4" />
                  <span>{location}</span>
                </div>
              )}
            </div>
          </div>

          {/* Admin Info */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Admin:</span>
            <UserName pubkey={resolvedPubkey} />
            <button
              onClick={handleOpenProfile}
              className="text-muted-foreground hover:text-foreground"
              title="View Profile"
            >
              <ExternalLink className="size-3.5" />
            </button>
          </div>

          {/* No Community Event Warning */}
          {noCommunityEvent && (
            <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-lg p-4 flex items-start gap-3">
              <Users2 className="size-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-yellow-500">
                  No Community Found
                </h3>
                <p className="text-sm text-muted-foreground">
                  This pubkey does not have a Communikeys community event (kind{" "}
                  {COMMUNIKEY_KIND}). The profile exists but no community has
                  been created for it.
                </p>
              </div>
            </div>
          )}

          {/* Content Sections */}
          {contentSections.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Layers className="size-5" />
                Content Sections
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contentSections.map((section, idx) => (
                  <ContentSectionCard
                    key={idx}
                    section={section}
                    communityPubkey={resolvedPubkey}
                  />
                ))}
              </div>

              {/* Quick Actions for Chat/Forum */}
              {contentSections.some((s) => s.kinds.includes(9)) && (
                <button
                  onClick={() => handleOpenChat(9)}
                  className="flex items-center gap-2 text-sm text-primary hover:underline w-fit"
                >
                  <MessageSquare className="size-4" />
                  View Community Chat
                </button>
              )}
            </div>
          )}

          {/* Infrastructure */}
          {(communityRelays.length > 0 ||
            blossomServers.length > 0 ||
            mints.length > 0) && (
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold">Infrastructure</h2>

              {/* Relays */}
              {communityRelays.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm text-muted-foreground flex items-center gap-1">
                    <Server className="size-3.5" />
                    Relays
                  </h3>
                  <div className="flex flex-col gap-1">
                    {communityRelays.map((relay, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenRelayViewer(relay)}
                          className="text-xs bg-muted hover:bg-muted/80 rounded px-2 py-1 font-mono truncate transition-colors flex items-center gap-1"
                        >
                          {relay}
                          <ExternalLink className="size-3" />
                        </button>
                        {idx === 0 && (
                          <span className="text-xs text-primary">(main)</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blossom Servers */}
              {blossomServers.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm text-muted-foreground flex items-center gap-1">
                    <Flower2 className="size-3.5" />
                    Blossom Servers
                  </h3>
                  <div className="flex flex-col gap-1">
                    {blossomServers.map((server, idx) => (
                      <code
                        key={idx}
                        className="text-xs bg-muted rounded px-2 py-1 font-mono truncate"
                      >
                        {server}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* Mints */}
              {mints.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm text-muted-foreground flex items-center gap-1">
                    <Coins className="size-3.5" />
                    Ecash Mints
                  </h3>
                  <div className="flex flex-col gap-1">
                    {mints.map((mint, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <code className="text-xs bg-muted rounded px-2 py-1 font-mono truncate">
                          {mint.url}
                        </code>
                        {mint.type && (
                          <span className="text-xs text-muted-foreground">
                            ({mint.type})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Badge Requirements */}
          {badgeRequirements.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Award className="size-5" />
                Required Badges
              </h2>
              <p className="text-sm text-muted-foreground">
                Users need one of these badges to publish content:
              </p>
              <div className="flex flex-wrap gap-2">
                {badgeRequirements.map((badge, idx) => (
                  <code
                    key={idx}
                    className="text-xs bg-muted rounded px-2 py-1 font-mono truncate"
                    title={badge}
                  >
                    {badge.length > 40
                      ? `${badge.slice(0, 20)}...${badge.slice(-15)}`
                      : badge}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Terms of Service */}
          {tos && (
            <div className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <FileText className="size-5" />
                Terms of Service
              </h2>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted rounded px-2 py-1 font-mono truncate">
                  {tos.reference}
                </code>
                {tos.relay && (
                  <span className="text-xs text-muted-foreground">
                    via {tos.relay}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Geohash (technical detail) */}
          {geohash && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Geohash</span>
              <code className="font-mono">{geohash}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
