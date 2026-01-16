import { User, HardDrive, Palette, Mail, Lock } from "lucide-react";
import accounts from "@/services/accounts";
import { useProfile } from "@/hooks/useProfile";
import { use$ } from "applesauce-react/hooks";
import { getDisplayName } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "dexie-react-hooks";
import giftWrapManager from "@/services/gift-wrap";
import { dmRelayListCache } from "@/services/dm-relay-list-cache";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Nip05 from "./nip05";
import { RelayLink } from "./RelayLink";
import SettingsDialog from "@/components/SettingsDialog";
import LoginDialog from "./LoginDialog";
import { useState } from "react";
import { useTheme } from "@/lib/themes";

function UserAvatar({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return (
    <Avatar className="size-4">
      <AvatarImage
        src={profile?.picture}
        alt={getDisplayName(pubkey, profile)}
      />
      <AvatarFallback>
        {getDisplayName(pubkey, profile).slice(2)}
      </AvatarFallback>
    </Avatar>
  );
}

function UserLabel({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return (
    <div className="flex flex-col gap-0">
      <span className="text-sm">{getDisplayName(pubkey, profile)}</span>
      {profile ? (
        <span className="text-xs text-muted-foreground">
          <Nip05 pubkey={pubkey} profile={profile} />
        </span>
      ) : null}
    </div>
  );
}

export default function UserMenu() {
  const account = use$(accounts.active$);
  const { state, addWindow } = useGrimoire();
  const relays = state.activeAccount?.relays;
  const blossomServers = state.activeAccount?.blossomServers;
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const { themeId, setTheme, availableThemes } = useTheme();
  // Get DM relays (kind 10050) for active user
  const dmRelays = useLiveQuery(async () => {
    if (!account?.pubkey) return null;
    const relays = await dmRelayListCache.get(account.pubkey);
    return relays.length > 0 ? relays : null;
  }, [account?.pubkey]);

  // Get pending gift wrap count
  const syncState = use$(giftWrapManager.state);
  const pendingCount =
    account?.pubkey &&
    state.privateMessagesEnabled &&
    !state.autoDecryptGiftWraps
      ? (syncState?.pendingCount ?? 0)
      : 0;

  function openProfile() {
    if (!account?.pubkey) return;
    addWindow(
      "profile",
      { pubkey: account.pubkey },
      `Profile ${account.pubkey.slice(0, 8)}...`,
    );
  }

  async function logout() {
    if (!account) return;
    accounts.removeAccount(account);
  }

  return (
    <>
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="link"
            aria-label={account ? "User menu" : "Log in"}
          >
            {account ? (
              <UserAvatar pubkey={account.pubkey} />
            ) : (
              <User className="size-4 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-80" align="start">
          {account ? (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel
                  className="cursor-crosshair hover:bg-muted/50"
                  onClick={openProfile}
                >
                  <UserLabel pubkey={account.pubkey} />
                </DropdownMenuLabel>
              </DropdownMenuGroup>

              {relays && relays.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                      Relays
                    </DropdownMenuLabel>
                    {relays.map((relay) => (
                      <RelayLink
                        className="px-2 py-1"
                        urlClassname="text-sm"
                        iconClassname="size-4"
                        key={relay.url}
                        url={relay.url}
                        read={relay.read}
                        write={relay.write}
                      />
                    ))}
                  </DropdownMenuGroup>
                </>
              )}

              {dmRelays && dmRelays.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
                      <Lock className="size-3.5" />
                      <span>Private Inbox Relays</span>
                    </DropdownMenuLabel>
                    {dmRelays.map((relay) => (
                      <DropdownMenuItem
                        key={relay}
                        className="text-sm truncate"
                      >
                        <RelayLink url={relay} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}

              {blossomServers && blossomServers.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal flex items-center gap-1.5">
                      <HardDrive className="size-3.5" />
                      <span>Blossom Servers</span>
                    </DropdownMenuLabel>
                    {blossomServers.map((server) => (
                      <DropdownMenuItem
                        key={server}
                        className="cursor-crosshair"
                        onClick={() => {
                          addWindow(
                            "blossom",
                            { subcommand: "list", serverUrl: server },
                            `Files on ${server}`,
                          );
                        }}
                      >
                        <HardDrive className="size-4 text-muted-foreground mr-2" />
                        <span className="text-sm truncate">{server}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="cursor-crosshair"
                  onClick={() => {
                    addWindow("inbox", {}, "Inbox");
                  }}
                >
                  <Mail className="size-4 mr-2" />
                  <span className="text-sm flex-1">Private Messages</span>
                  {pendingCount != null && pendingCount > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-primary text-primary-foreground font-medium">
                      {pendingCount}
                    </span>
                  )}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-crosshair">
                  <Palette className="size-4 mr-2" />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {availableThemes.map((theme) => (
                    <DropdownMenuItem
                      key={theme.id}
                      className="cursor-crosshair"
                      onClick={() => setTheme(theme.id)}
                    >
                      <span
                        className={`size-2 rounded-full mr-2 ${
                          themeId === theme.id
                            ? "bg-primary"
                            : "bg-muted-foreground/30"
                        }`}
                      />
                      {theme.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-crosshair">
                Log out
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-crosshair">
                  <Palette className="size-4 mr-2" />
                  Theme
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {availableThemes.map((theme) => (
                    <DropdownMenuItem
                      key={theme.id}
                      className="cursor-crosshair"
                      onClick={() => setTheme(theme.id)}
                    >
                      <span
                        className={`size-2 rounded-full mr-2 ${
                          themeId === theme.id
                            ? "bg-primary"
                            : "bg-muted-foreground/30"
                        }`}
                      />
                      {theme.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogin(true)}>
                Log in
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
