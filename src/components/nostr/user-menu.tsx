import { User, Wallet, Zap } from "lucide-react";
import accounts from "@/services/accounts";
import walletManager from "@/services/wallet";
import { useProfile } from "@/hooks/useProfile";
import { use$ } from "applesauce-react/hooks";
import { getDisplayName } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Nip05 from "./nip05";
import { RelayLink } from "./RelayLink";
import SettingsDialog from "@/components/SettingsDialog";
import LoginDialog from "./LoginDialog";
import WalletConnectDialog from "@/components/WalletConnectDialog";
import { useState } from "react";

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
  const walletState = use$(walletManager.state$);
  const { state, addWindow } = useGrimoire();
  const relays = state.activeAccount?.relays;
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showWalletConnect, setShowWalletConnect] = useState(false);

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

  function openWallet() {
    addWindow("wallet", {}, "Wallet");
  }

  function disconnectWallet() {
    walletManager.disconnect();
  }

  function formatBalance(msats: number): string {
    const sats = Math.floor(msats / 1000);
    if (sats >= 1000000) {
      return `${(sats / 1000000).toFixed(2)}M`;
    } else if (sats >= 1000) {
      return `${(sats / 1000).toFixed(2)}K`;
    }
    return sats.toString();
  }

  return (
    <>
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
      <WalletConnectDialog
        open={showWalletConnect}
        onOpenChange={setShowWalletConnect}
      />
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

              <DropdownMenuSeparator />

              {/* Wallet Section */}
              {walletState.connected && walletState.info ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Wallet
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={openWallet}
                    className="cursor-crosshair"
                  >
                    <Wallet className="mr-2 size-4" />
                    <div className="flex flex-col gap-0">
                      <span className="text-sm">
                        {walletState.info.alias || "Connected Wallet"}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Zap className="size-3" />
                        {formatBalance(walletState.info.balance)} sats
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={disconnectWallet}
                    className="cursor-pointer text-muted-foreground"
                  >
                    Disconnect Wallet
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : (
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => setShowWalletConnect(true)}
                    className="cursor-pointer"
                  >
                    <Wallet className="mr-2 size-4" />
                    Connect Wallet
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              )}

              <DropdownMenuSeparator />
              {/* <DropdownMenuItem
                onClick={() => setShowSettings(true)}
                className="cursor-pointer"
              >
                <Settings className="mr-2 size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator /> */}
              <DropdownMenuItem onClick={logout} className="cursor-crosshair">
                Log out
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={() => setShowLogin(true)}>
              Log in
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
