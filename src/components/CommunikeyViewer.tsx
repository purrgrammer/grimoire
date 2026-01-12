import { useEffect } from "react";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { addressLoader } from "@/services/loaders";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import {
  getCommunikeyRelays,
  getCommunikeyContentSections,
  getCommunikeyDescription,
  getCommunikeyBlossomServers,
  getCommunikeyMints,
  getCommunikeyLocation,
  getCommunikeyTos,
} from "@/lib/communikeys-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  Radio,
  MessageCircle,
  Server,
  Coins,
  MapPin,
  FileText,
  Award,
  Lock,
  Copy,
  CopyCheck,
  User as UserIcon,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { UserName } from "./nostr/UserName";
import { useCopy } from "@/hooks/useCopy";
import { getKindName, getKindIcon } from "@/constants/kinds";
import type { ContentSection } from "@/lib/communikeys-helpers";

const COMMUNIKEY_KIND = 10222;

export interface CommunikeyViewerProps {
  pubkey: string;
  relays?: string[];
}

/**
 * CommunikeyViewer - View a Communikey community
 * Shows community profile, configuration, and content sections
 */
export function CommunikeyViewer({ pubkey, relays }: CommunikeyViewerProps) {
  const { state, addWindow } = useGrimoire();
  const accountPubkey = state.activeAccount?.pubkey;
  const eventStore = useEventStore();
  const { copy, copied } = useCopy();

  // Resolve $me alias
  const resolvedPubkey = pubkey === "$me" ? accountPubkey : pubkey;

  // Get community profile (kind:0 metadata)
  const profile = useProfile(resolvedPubkey);
  const displayName = getDisplayName(resolvedPubkey || "", profile);

  // Fetch community config (kind:10222) from network
  useEffect(() => {
    if (!resolvedPubkey) return;

    const subscription = addressLoader({
      kind: COMMUNIKEY_KIND,
      pubkey: resolvedPubkey,
      identifier: "",
      relays: relays,
    }).subscribe({
      error: (err) => {
        console.debug(
          `[CommunikeyViewer] Failed to fetch community config for ${resolvedPubkey.slice(0, 8)}:`,
          err,
        );
      },
    });

    return () => subscription.unsubscribe();
  }, [resolvedPubkey, relays]);

  // Get community config event (kind 10222) from store
  const communityEvent = use$(
    () =>
      resolvedPubkey
        ? eventStore.replaceable(COMMUNIKEY_KIND, resolvedPubkey, "")
        : undefined,
    [eventStore, resolvedPubkey],
  );

  // Parse community configuration
  const communityRelays = communityEvent
    ? getCommunikeyRelays(communityEvent)
    : [];
  const contentSections = communityEvent
    ? getCommunikeyContentSections(communityEvent)
    : [];
  const description =
    (communityEvent ? getCommunikeyDescription(communityEvent) : null) ||
    profile?.about;
  const blossomServers = communityEvent
    ? getCommunikeyBlossomServers(communityEvent)
    : [];
  const mints = communityEvent ? getCommunikeyMints(communityEvent) : [];
  const location = communityEvent
    ? getCommunikeyLocation(communityEvent)
    : undefined;
  const tos = communityEvent ? getCommunikeyTos(communityEvent) : undefined;

  // Check if chat is supported (kind 9 in any section)
  const hasChat = contentSections.some((section) => section.kinds.includes(9));

  // Generate npub for copying
  const npub = resolvedPubkey ? nip19.npubEncode(resolvedPubkey) : "";

  // Open chat for this community
  const openChat = () => {
    if (resolvedPubkey) {
      addWindow("chat", { identifier: npub });
    }
  };

  // View community profile
  const viewProfile = () => {
    if (resolvedPubkey) {
      addWindow("profile", { pubkey: resolvedPubkey });
    }
  };

  if (pubkey === "$me" && !accountPubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="text-muted-foreground">
          <UserIcon className="size-12 mx-auto mb-3" />
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: npub */}
        <button
          onClick={() => copy(npub)}
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

        {/* Right: Community icon */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Users className="size-3" />
            <span>Communikey</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
          {/* Header */}
          <header className="flex flex-col gap-4 border-b border-border pb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {profile?.picture ? (
                  <img
                    src={profile.picture}
                    alt={displayName}
                    className="size-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="size-16 rounded-full bg-muted flex items-center justify-center">
                    <Users className="size-8 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <h1 className="text-2xl font-bold">{displayName}</h1>
                  <button
                    onClick={viewProfile}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    <UserName pubkey={resolvedPubkey} className="text-sm" />
                  </button>
                </div>
              </div>

              {hasChat && (
                <Button onClick={openChat} className="gap-2">
                  <MessageCircle className="size-4" />
                  Open Chat
                </Button>
              )}
            </div>

            {/* Description */}
            {description && (
              <p className="text-muted-foreground whitespace-pre-wrap">
                {description}
              </p>
            )}

            {/* Location */}
            {location && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="size-4" />
                {location}
              </div>
            )}

            {/* Quick stats */}
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="gap-1">
                <Radio className="size-3" />
                {communityRelays.length}{" "}
                {communityRelays.length === 1 ? "relay" : "relays"}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <FileText className="size-3" />
                {contentSections.length}{" "}
                {contentSections.length === 1 ? "section" : "sections"}
              </Badge>
              {blossomServers.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Server className="size-3" />
                  {blossomServers.length} blossom{" "}
                  {blossomServers.length === 1 ? "server" : "servers"}
                </Badge>
              )}
              {mints.length > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Coins className="size-3" />
                  {mints.length} {mints.length === 1 ? "mint" : "mints"}
                </Badge>
              )}
            </div>

            {/* No community config warning */}
            {!communityEvent && (
              <div className="p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
                <p>
                  No community configuration found (kind 10222). This pubkey may
                  not have set up a Communikey community yet.
                </p>
              </div>
            )}
          </header>

          {/* Content Sections */}
          {contentSections.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4">Content Sections</h2>
              <div className="grid gap-4">
                {contentSections.map((section) => (
                  <ContentSectionCard key={section.name} section={section} />
                ))}
              </div>
            </section>
          )}

          {/* Relays */}
          {communityRelays.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Radio className="size-5" />
                Relays
              </h2>
              <div className="grid gap-2">
                {communityRelays.map((relay, index) => (
                  <div
                    key={relay}
                    className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                  >
                    <Radio className="size-4 text-muted-foreground" />
                    <code className="text-sm flex-1 break-all">{relay}</code>
                    {index === 0 && (
                      <Badge variant="outline" className="text-xs">
                        Main
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Blossom Servers */}
          {blossomServers.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Server className="size-5" />
                Blossom Servers
              </h2>
              <div className="grid gap-2">
                {blossomServers.map((server) => (
                  <div
                    key={server}
                    className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                  >
                    <Server className="size-4 text-muted-foreground" />
                    <code className="text-sm flex-1 break-all">{server}</code>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Ecash Mints */}
          {mints.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Coins className="size-5" />
                Ecash Mints
              </h2>
              <div className="grid gap-2">
                {mints.map((mint) => (
                  <div
                    key={mint.url}
                    className="flex items-center gap-2 p-2 rounded-md bg-muted/50"
                  >
                    <Coins className="size-4 text-muted-foreground" />
                    <code className="text-sm flex-1 break-all">{mint.url}</code>
                    {mint.protocol && (
                      <Badge variant="outline" className="text-xs">
                        {mint.protocol}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Terms of Service */}
          {tos && (
            <section>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText className="size-5" />
                Terms of Service
              </h2>
              <div className="p-2 rounded-md bg-muted/50">
                <code className="text-sm break-all">{tos.id}</code>
                {tos.relay && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Relay: {tos.relay}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Card component for displaying a content section
 */
function ContentSectionCard({ section }: { section: ContentSection }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span>{section.name}</span>
          <div className="flex gap-1">
            {section.exclusive && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Lock className="size-3" />
                Exclusive
              </Badge>
            )}
            {section.fee && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Coins className="size-3" />
                {section.fee.amount} {section.fee.unit}
              </Badge>
            )}
            {section.badgeRequirement && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Award className="size-3" />
                Badge Required
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {section.kinds.map((kind) => {
            const KindIcon = getKindIcon(kind);
            return (
              <Badge key={kind} variant="outline" className="gap-1">
                <KindIcon className="size-3" />
                {getKindName(kind)}
                <span className="text-muted-foreground">({kind})</span>
              </Badge>
            );
          })}
        </div>
        {section.badgeRequirement && (
          <p className="text-xs text-muted-foreground mt-2">
            Requires badge: <code>{section.badgeRequirement}</code>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
