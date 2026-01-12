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
} from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import {
  getCommunikeyRelays,
  getCommunikeyContentSections,
  getCommunikeyDescription,
  getCommunikeyBlossomServers,
  getCommunikeyMints,
  getCommunikeyLocation,
  getCommunikeyTos,
  type ContentSection,
} from "@/lib/communikeys-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getKindName, getKindIcon } from "@/constants/kinds";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 10222 - Communikey (Community Definition)
 * Displays full community configuration including relays, content sections, and settings
 */
export function CommunikeyDetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();

  // Get community profile (kind:0 metadata)
  const profile = useProfile(event.pubkey);
  const displayName = getDisplayName(event.pubkey, profile);

  // Get community configuration from the event
  const relays = getCommunikeyRelays(event);
  const contentSections = getCommunikeyContentSections(event);
  const description = getCommunikeyDescription(event) || profile?.about;
  const blossomServers = getCommunikeyBlossomServers(event);
  const mints = getCommunikeyMints(event);
  const location = getCommunikeyLocation(event);
  const tos = getCommunikeyTos(event);

  // Check if chat is supported (kind 9 in any section)
  const hasChat = contentSections.some((section) => section.kinds.includes(9));

  // Open chat for this community
  const openChat = () => {
    const npub = nip19.npubEncode(event.pubkey);
    addWindow("chat", { identifier: npub });
  };

  // View community profile
  const viewProfile = () => {
    addWindow("profile", { pubkey: event.pubkey });
  };

  return (
    <div dir="auto" className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
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
                <UserName pubkey={event.pubkey} className="text-sm" />
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
            {relays.length} {relays.length === 1 ? "relay" : "relays"}
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
      </header>

      {/* Content Sections */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Content Sections</h2>
        <div className="grid gap-4">
          {contentSections.map((section) => (
            <ContentSectionCard key={section.name} section={section} />
          ))}
          {contentSections.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No content sections defined
            </p>
          )}
        </div>
      </section>

      {/* Relays */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Radio className="size-5" />
          Relays
        </h2>
        <div className="grid gap-2">
          {relays.map((relay, index) => (
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
          {relays.length === 0 && (
            <p className="text-muted-foreground text-sm">No relays specified</p>
          )}
        </div>
      </section>

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
