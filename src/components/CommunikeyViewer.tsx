import { useEffect, useState, lazy, Suspense } from "react";
import { useEventStore, use$ } from "applesauce-react/hooks";
import { addressLoader } from "@/services/loaders";
import { useProfile } from "@/hooks/useProfile";
import { useTimeline } from "@/hooks/useTimeline";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Info,
  Loader2,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { UserName } from "./nostr/UserName";
import { useCopy } from "@/hooks/useCopy";
import { getKindName, getKindIcon } from "@/constants/kinds";
import { KindRenderer } from "./nostr/kinds";
import { EventErrorBoundary } from "./EventErrorBoundary";
import type { ContentSection } from "@/lib/communikeys-helpers";
import type { NostrEvent } from "@/types/nostr";

// Lazy load ChatViewer to avoid circular dependency
const ChatViewer = lazy(() =>
  import("./ChatViewer").then((m) => ({ default: m.ChatViewer })),
);

const COMMUNIKEY_KIND = 10222;

export interface CommunikeyViewerProps {
  pubkey: string;
  relays?: string[];
}

/**
 * CommunikeyViewer - View a Communikey community
 * Shows community profile with tabbed content sections and chat
 */
export function CommunikeyViewer({ pubkey, relays }: CommunikeyViewerProps) {
  const { state } = useGrimoire();
  const accountPubkey = state.activeAccount?.pubkey;
  const eventStore = useEventStore();
  const { copy, copied } = useCopy();
  const [activeTab, setActiveTab] = useState("chat");

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

  // Generate npub for copying
  const npub = resolvedPubkey ? nip19.npubEncode(resolvedPubkey) : "";

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
      <div className="border-b border-border px-4 py-2 flex items-center justify-between gap-3">
        {/* Left: Profile info */}
        <div className="flex items-center gap-2 min-w-0">
          {profile?.picture ? (
            <img
              src={profile.picture}
              alt={displayName}
              className="size-8 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="size-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Users className="size-4 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{displayName}</h1>
            <p className="text-xs text-muted-foreground truncate">
              {description?.slice(0, 60)}
              {description && description.length > 60 ? "..." : ""}
            </p>
          </div>
        </div>

        {/* Right: npub copy button */}
        <button
          onClick={() => copy(npub)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 font-mono"
          title={npub}
          aria-label="Copy community ID"
        >
          {copied ? (
            <CopyCheck className="size-3" />
          ) : (
            <Copy className="size-3" />
          )}
          <code className="hidden sm:inline">{npub.slice(0, 12)}...</code>
        </button>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0 h-auto">
          {/* Chat tab - always first */}
          <TabsTrigger
            value="chat"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 gap-1.5"
          >
            <MessageCircle className="size-4" />
            Chat
          </TabsTrigger>

          {/* Content section tabs */}
          {contentSections.map((section) => {
            const FirstKindIcon = section.kinds[0]
              ? getKindIcon(section.kinds[0])
              : FileText;
            return (
              <TabsTrigger
                key={section.name}
                value={`section-${section.name}`}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 gap-1.5"
              >
                <FirstKindIcon className="size-4" />
                {section.name}
              </TabsTrigger>
            );
          })}

          {/* Info tab - always last */}
          <TabsTrigger
            value="info"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2 gap-1.5"
          >
            <Info className="size-4" />
            Info
          </TabsTrigger>
        </TabsList>

        {/* Chat content */}
        <TabsContent
          value="chat"
          className="flex-1 overflow-hidden mt-0 data-[state=inactive]:hidden"
        >
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <ChatViewer
              protocol="communikeys"
              identifier={{
                type: "communikey",
                value: resolvedPubkey,
                relays: communityRelays,
              }}
            />
          </Suspense>
        </TabsContent>

        {/* Content section tabs */}
        {contentSections.map((section) => (
          <TabsContent
            key={section.name}
            value={`section-${section.name}`}
            className="flex-1 overflow-auto mt-0"
          >
            <ContentSectionFeed
              section={section}
              communityPubkey={resolvedPubkey}
              relays={communityRelays}
            />
          </TabsContent>
        ))}

        {/* Info content */}
        <TabsContent value="info" className="flex-1 overflow-auto mt-0">
          <CommunityInfo
            profile={profile}
            displayName={displayName}
            description={description}
            location={location}
            communityRelays={communityRelays}
            contentSections={contentSections}
            blossomServers={blossomServers}
            mints={mints}
            tos={tos}
            communityEvent={communityEvent}
            resolvedPubkey={resolvedPubkey}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * ContentSectionFeed - Displays a feed of events for a content section
 */
function ContentSectionFeed({
  section,
  communityPubkey,
  relays,
}: {
  section: ContentSection;
  communityPubkey: string;
  relays: string[];
}) {
  const { events, loading } = useTimeline(
    `communikey-${communityPubkey}-${section.name}`,
    {
      kinds: section.kinds,
      "#h": [communityPubkey],
    },
    relays,
    { limit: 50 },
  );

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
        <p className="text-sm">No content in this section yet</p>
        <p className="text-xs mt-1">
          Content types: {section.kinds.map((k) => getKindName(k)).join(", ")}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {events.map((event) => (
        <FeedEvent key={event.id} event={event} />
      ))}
    </div>
  );
}

/**
 * FeedEvent - Renders a single event with error boundary
 */
function FeedEvent({ event }: { event: NostrEvent }) {
  return (
    <EventErrorBoundary event={event}>
      <KindRenderer event={event} />
    </EventErrorBoundary>
  );
}

/**
 * CommunityInfo - Shows detailed community information
 */
function CommunityInfo({
  profile,
  displayName,
  description,
  location,
  communityRelays,
  contentSections,
  blossomServers,
  mints,
  tos,
  communityEvent,
  resolvedPubkey,
}: {
  profile: any;
  displayName: string;
  description?: string;
  location?: string;
  communityRelays: string[];
  contentSections: ContentSection[];
  blossomServers: string[];
  mints: { url: string; protocol?: string }[];
  tos?: { id: string; relay?: string };
  communityEvent?: NostrEvent;
  resolvedPubkey: string;
}) {
  const { addWindow } = useGrimoire();

  const viewProfile = () => {
    addWindow("profile", { pubkey: resolvedPubkey });
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
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
              No community configuration found (kind 10222). This pubkey may not
              have set up a Communikey community yet.
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
  );
}

/**
 * Card component for displaying a content section
 */
function ContentSectionCard({ section }: { section: ContentSection }) {
  return (
    <div className="p-4 rounded-md border border-border">
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium">{section.name}</span>
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
      </div>
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
    </div>
  );
}
