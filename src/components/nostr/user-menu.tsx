import {
  User,
  HardDrive,
  Palette,
  Wallet,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  Zap,
} from "lucide-react";
import accounts from "@/services/accounts";
import { useProfile } from "@/hooks/useProfile";
import { use$ } from "applesauce-react/hooks";
import { getDisplayName } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Nip05 from "./nip05";
import { RelayLink } from "./RelayLink";
import SettingsDialog from "@/components/SettingsDialog";
import LoginDialog from "./LoginDialog";
import ConnectWalletDialog from "@/components/ConnectWalletDialog";
import { useState } from "react";
import { useTheme } from "@/lib/themes";
import { toast } from "sonner";
import { useWallet } from "@/hooks/useWallet";
import { Progress } from "@/components/ui/progress";
import {
  GRIMOIRE_DONATE_PUBKEY,
  GRIMOIRE_LIGHTNING_ADDRESS,
} from "@/lib/grimoire-members";
import { MONTHLY_GOAL_SATS } from "@/services/supporters";

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
  const { state, addWindow, disconnectNWC, toggleWalletBalancesBlur } =
    useGrimoire();
  const relays = state.activeAccount?.relays;
  const blossomServers = state.activeAccount?.blossomServers;
  const nwcConnection = state.nwcConnection;
  const [showSettings, setShowSettings] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showConnectWallet, setShowConnectWallet] = useState(false);
  const [showWalletInfo, setShowWalletInfo] = useState(false);
  const { themeId, setTheme, availableThemes } = useTheme();

  // Calculate monthly donations reactively from DB (last 30 days)
  const monthlyDonations =
    useLiveQuery(async () => {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      let total = 0;
      await db.grimoireZaps
        .where("timestamp")
        .aboveOrEqual(thirtyDaysAgo)
        .each((zap) => {
          total += zap.amountSats;
        });
      return total;
    }, []) ?? 0;

  // Calculate monthly donation progress
  const goalProgress = (monthlyDonations / MONTHLY_GOAL_SATS) * 100;

  // Format numbers for display
  function formatSats(sats: number): string {
    if (sats >= 1_000_000) {
      return `${(sats / 1_000_000).toFixed(1)}M`;
    } else if (sats >= 1_000) {
      return `${Math.floor(sats / 1_000)}k`;
    }
    return sats.toString();
  }

  // Get wallet service profile for display name, using wallet relays as hints
  const walletServiceProfile = useProfile(
    nwcConnection?.service,
    nwcConnection?.relays,
  );

  // Use wallet hook for real-time balance and methods
  const {
    disconnect: disconnectWallet,
    refreshBalance,
    balance,
    wallet,
  } = useWallet();

  function openProfile() {
    if (!account?.pubkey) return;
    addWindow(
      "profile",
      { pubkey: account.pubkey },
      `Profile ${account.pubkey.slice(0, 8)}...`,
    );
  }

  function openWallet() {
    addWindow("wallet", {}, "Wallet");
  }

  function openDonate() {
    addWindow(
      "zap",
      {
        recipientPubkey: GRIMOIRE_DONATE_PUBKEY,
        recipientLightningAddress: GRIMOIRE_LIGHTNING_ADDRESS,
      },
      "Support Grimoire",
    );
  }

  async function logout() {
    if (!account) return;
    accounts.removeAccount(account);
  }

  function formatBalance(millisats?: number): string {
    if (millisats === undefined) return "—";
    const sats = Math.floor(millisats / 1000);
    return sats.toLocaleString();
  }

  function handleDisconnectWallet() {
    // Disconnect from NWC service (stops notifications, clears wallet instance)
    disconnectWallet();
    // Clear connection from state
    disconnectNWC();
    setShowWalletInfo(false);
    toast.success("Wallet disconnected");
  }

  async function handleRefreshBalance() {
    try {
      await refreshBalance();
      toast.success("Balance refreshed");
    } catch (_error) {
      toast.error("Failed to refresh balance");
    }
  }

  function getWalletName(): string {
    if (!nwcConnection) return "";
    // Use service pubkey profile name, fallback to alias, then pubkey slice
    return (
      getDisplayName(nwcConnection.service, walletServiceProfile) ||
      nwcConnection.info?.alias ||
      nwcConnection.service.slice(0, 8)
    );
  }

  function openWalletServiceProfile() {
    if (!nwcConnection?.service) return;
    addWindow(
      "profile",
      { pubkey: nwcConnection.service },
      `Profile ${nwcConnection.service.slice(0, 8)}...`,
    );
    setShowWalletInfo(false);
  }

  return (
    <>
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <LoginDialog open={showLogin} onOpenChange={setShowLogin} />
      <ConnectWalletDialog
        open={showConnectWallet}
        onOpenChange={setShowConnectWallet}
        onConnected={openWallet}
      />

      {/* Wallet Info Dialog */}
      {nwcConnection && (
        <Dialog open={showWalletInfo} onOpenChange={setShowWalletInfo}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Wallet Info</DialogTitle>
              <DialogDescription>
                Connected Lightning wallet details
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Balance */}
              {(balance !== undefined ||
                nwcConnection.balance !== undefined) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Balance:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleWalletBalancesBlur}
                      className="text-lg font-semibold hover:opacity-70 transition-opacity cursor-pointer flex items-center gap-1.5"
                      title="Click to toggle privacy blur"
                    >
                      <span>
                        {state.walletBalancesBlurred
                          ? "✦✦✦✦✦✦"
                          : formatBalance(balance ?? nwcConnection.balance)}
                      </span>
                      {state.walletBalancesBlurred ? (
                        <EyeOff className="size-3 text-muted-foreground" />
                      ) : (
                        <Eye className="size-3 text-muted-foreground" />
                      )}
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRefreshBalance}
                      title="Refresh balance"
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Wallet Name */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Wallet:</span>
                <button
                  onClick={openWalletServiceProfile}
                  className="text-sm font-medium hover:underline cursor-crosshair text-primary"
                >
                  {getWalletName()}
                </button>
              </div>

              {/* Connection Status */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status:</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${
                      wallet ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className="text-sm font-medium">
                    {wallet ? "Connected" : "Disconnected"}
                  </span>
                </div>
              </div>

              {/* Lightning Address */}
              {nwcConnection.lud16 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Address:
                  </span>
                  <span className="text-sm font-mono">
                    {nwcConnection.lud16}
                  </span>
                </div>
              )}

              {/* Supported Methods */}
              {nwcConnection.info?.methods &&
                nwcConnection.info.methods.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground">
                      Supported Methods:
                    </span>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {nwcConnection.info.methods.map((method) => (
                        <span
                          key={method}
                          className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium"
                        >
                          {method}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {/* Relays */}
              <div>
                <span className="text-sm text-muted-foreground">Relays:</span>
                <div className="mt-2 space-y-1">
                  {nwcConnection.relays.map((relay) => (
                    <RelayLink
                      key={relay}
                      url={relay}
                      className="py-1"
                      urlClassname="text-xs"
                      iconClassname="size-3.5"
                    />
                  ))}
                </div>
              </div>

              {/* Disconnect Button */}
              <Button
                onClick={handleDisconnectWallet}
                variant="destructive"
                className="w-full"
              >
                <X className="mr-2 size-4" />
                Disconnect Wallet
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

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
          {account && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel
                  className="cursor-crosshair hover:bg-muted/50"
                  onClick={openProfile}
                >
                  <UserLabel pubkey={account.pubkey} />
                </DropdownMenuLabel>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
            </>
          )}

          {/* Wallet Section - Always show */}
          {nwcConnection ? (
            <DropdownMenuItem
              className="cursor-crosshair flex items-center justify-between"
              onClick={openWallet}
            >
              <div className="flex items-center gap-2">
                <Wallet className="size-4 text-muted-foreground" />
                {balance !== undefined ||
                nwcConnection.balance !== undefined ? (
                  <span className="text-sm">
                    {state.walletBalancesBlurred
                      ? "✦✦✦✦"
                      : formatBalance(balance ?? nwcConnection.balance)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`size-1.5 rounded-full ${
                    wallet ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {getWalletName()}
                </span>
              </div>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="cursor-crosshair"
              onClick={() => setShowConnectWallet(true)}
            >
              <Wallet className="size-4 text-muted-foreground mr-2" />
              <span className="text-sm">Connect Wallet</span>
            </DropdownMenuItem>
          )}

          {/* Support Grimoire Section */}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <div
              className="px-2 py-2 cursor-crosshair hover:bg-accent/50 transition-colors"
              onClick={openDonate}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Zap className="size-4 text-yellow-500" />
                <span className="text-sm font-medium">Support Grimoire</span>
              </div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">Monthly goal</span>
                <span className="font-medium">
                  {formatSats(monthlyDonations)} /{" "}
                  {formatSats(MONTHLY_GOAL_SATS)} sats
                </span>
              </div>
              <Progress value={goalProgress} className="h-1.5" />
            </div>
          </DropdownMenuGroup>

          {account && (
            <>
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
              <DropdownMenuItem onClick={logout} className="cursor-crosshair">
                Log out
              </DropdownMenuItem>
            </>
          )}

          {!account && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogin(true)}>
                Log in
              </DropdownMenuItem>
            </>
          )}

          {/* Theme Section - Always show */}
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
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
