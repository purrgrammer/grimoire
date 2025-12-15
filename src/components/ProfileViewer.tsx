import { useProfile } from "@/hooks/useProfile";
import { UserName } from "./nostr/UserName";
import Nip05 from "./nostr/nip05";
import { ProfileCardSkeleton } from "@/components/ui/skeleton";
import {
  Copy,
  CopyCheck,
  User as UserIcon,
  Inbox,
  Send,
  Wifi,
} from "lucide-react";
import { kinds, nip19 } from "nostr-tools";
import { useEventStore, useObservableMemo } from "applesauce-react/hooks";
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
import { useCopy } from "../hooks/useCopy";
import { RichText } from "./nostr/RichText";
import { RelayLink } from "./nostr/RelayLink";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useRelayState } from "@/hooks/useRelayState";
import { getConnectionIcon, getAuthIcon } from "@/lib/relay-status-utils";

export interface ProfileViewerProps {
  pubkey: string;
}

/**
 * ProfileViewer - Detailed view for a user profile
 * Shows profile metadata, inbox/outbox relays, and raw JSON
 */
export function ProfileViewer({ pubkey }: ProfileViewerProps) {
  const profile = useProfile(pubkey);
  const eventStore = useEventStore();
  const { copy, copied } = useCopy();
  const { relays: relayStates } = useRelayState();

  // Get mailbox relays (kind 10002)
  const mailboxEvent = useObservableMemo(
    () => eventStore.replaceable(kinds.RelayList, pubkey, ""),
    [eventStore, pubkey],
  );
  const inboxRelays =
    mailboxEvent && mailboxEvent.tags ? getInboxes(mailboxEvent) : [];
  const outboxRelays =
    mailboxEvent && mailboxEvent.tags ? getOutboxes(mailboxEvent) : [];

  // Get profile metadata event (kind 0)
  const profileEvent = useObservableMemo(
    () => eventStore.replaceable(0, pubkey, ""),
    [eventStore, pubkey],
  );

  // Combine all relays (inbox + outbox) for nprofile
  const allRelays = [...new Set([...inboxRelays, ...outboxRelays])];

  // Calculate connection count for relay dropdown
  const connectedCount = allRelays.filter(
    (url) => relayStates[url]?.connectionState === "connected",
  ).length;

  // Generate npub or nprofile depending on relay availability
  const identifier =
    allRelays.length > 0
      ? nip19.nprofileEncode({
          pubkey,
          relays: allRelays,
        })
      : nip19.npubEncode(pubkey);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header - Single Line */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: npub/nprofile */}
        <button
          onClick={() => copy(identifier)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors truncate min-w-0"
          title={identifier}
          aria-label="Copy profile ID"
        >
          {copied ? (
            <CopyCheck className="size-3 flex-shrink-0" />
          ) : (
            <Copy className="size-3 flex-shrink-0" />
          )}
          <code className="truncate">
            {identifier.slice(0, 16)}...{identifier.slice(-8)}
          </code>
        </button>

        {/* Right: Profile icon and Relay dropdown */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <UserIcon className="size-3" />
            <span>Profile</span>
          </div>

          {allRelays.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`${allRelays.length} relay${allRelays.length !== 1 ? "s" : ""}`}
                >
                  <Wifi className="size-3" />
                  <span>
                    {connectedCount}/{allRelays.length}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {allRelays.map((url) => {
                  const state = relayStates[url];
                  const connIcon = getConnectionIcon(state);
                  const authIcon = getAuthIcon(state);
                  const isInbox = inboxRelays.includes(url);
                  const isOutbox = outboxRelays.includes(url);

                  return (
                    <DropdownMenuItem
                      key={url}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {isInbox && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Inbox className="size-3 text-muted-foreground flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Inbox</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {isOutbox && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Send className="size-3 text-muted-foreground flex-shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Outbox</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <RelayLink
                          url={url}
                          showInboxOutbox={false}
                          className="flex-1 min-w-0 hover:bg-transparent"
                          iconClassname="size-3"
                          urlClassname="text-xs"
                        />
                      </div>
                      <div
                        className="flex items-center gap-1.5 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {authIcon && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="cursor-help">{authIcon.icon}</div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{authIcon.label}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">{connIcon.icon}</div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{connIcon.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Profile Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!profile && !profileEvent && <ProfileCardSkeleton variant="full" />}

        {!profile && profileEvent && (
          <div className="text-center text-muted-foreground text-sm">
            No profile metadata found
          </div>
        )}

        {profile && (
          <div className="flex flex-col gap-4 max-w-2xl">
            <div className="flex flex-col gap-0">
              {/* Display Name */}
              <UserName
                pubkey={pubkey}
                className="text-2xl font-bold pointer-events-none"
              />
              {/* NIP-05 */}
              {profile.nip05 && (
                <div className="text-xs">
                  <Nip05 pubkey={pubkey} profile={profile} />
                </div>
              )}
            </div>

            {/* About/Bio */}
            {profile.about && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  About
                </div>
                <RichText
                  className="text-sm whitespace-pre-wrap break-words"
                  content={profile.about}
                />
              </div>
            )}

            {/* Website */}
            {profile.website && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Website
                </div>
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent underline decoration-dotted"
                >
                  {profile.website}
                </a>
              </div>
            )}

            {/* Lightning Address */}
            {profile.lud16 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Lightning Address
                </div>
                <code className="text-sm font-mono">{profile.lud16}</code>
              </div>
            )}

            {/* LUD06 (LNURL) */}
            {profile.lud06 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  LNURL
                </div>
                <code className="text-sm font-mono break-all">
                  {profile.lud06}
                </code>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
