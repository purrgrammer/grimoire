import { User, Check, UserPlus, Eye, Puzzle, Link2 } from "lucide-react";
import accounts from "@/services/accounts";
import { useProfile } from "@/hooks/useProfile";
import { useObservableMemo } from "applesauce-react/hooks";
import { getDisplayName } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Nip05 from "./nip05";
import { RelayLink } from "./RelayLink";
import SettingsDialog from "@/components/SettingsDialog";
import LoginDialog from "@/components/LoginDialog";
import { useState } from "react";
import type { IAccount } from "applesauce-accounts";
import type { ISigner } from "applesauce-signers";

function UserAvatar({ pubkey }: { pubkey: string }) {
  const profile = useProfile(pubkey);
  return (
    <Avatar className="size-4">
      <AvatarImage
        src={profile?.picture}
        alt={getDisplayName(pubkey, profile)}
      />
      <AvatarFallback>
        {getDisplayName(pubkey, profile).slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function getAccountTypeBadge(account: IAccount<ISigner, unknown, unknown>) {
  const accountType = (account.constructor as unknown as { type: string }).type;

  if (accountType === "grimoire-readonly" || accountType === "readonly") {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
        <Eye className="size-3 mr-1" />
        Read-only
      </Badge>
    );
  }

  if (accountType === "extension") {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
        <Puzzle className="size-3 mr-1" />
        Extension
      </Badge>
    );
  }

  if (accountType === "nostr-connect") {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
        <Link2 className="size-3 mr-1" />
        Remote
      </Badge>
    );
  }

  return null;
}

function UserLabel({
  account,
}: {
  account: IAccount<ISigner, unknown, unknown>;
}) {
  const profile = useProfile(account.pubkey);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 w-full">
        <span className="text-sm truncate">{getDisplayName(account.pubkey, profile)}</span>
        {getAccountTypeBadge(account)}
      </div>
      {profile ? (
        <span className="text-xs text-muted-foreground">
          <Nip05 pubkey={account.pubkey} profile={profile} />
        </span>
      ) : null}
    </div>
  );
}

export default function UserMenu() {
  const account = useObservableMemo(() => accounts.active$, []);
  const allAccounts = useObservableMemo(() => accounts.accounts$, []);
  const { state, addWindow } = useGrimoire();
  const relays = state.activeAccount?.relays;
  const [showSettings, setShowSettings] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  // Get other accounts (not the active one)
  const otherAccounts = allAccounts.filter((acc) => acc.id !== account?.id);

  function openProfile() {
    if (!account?.pubkey) return;
    addWindow(
      "profile",
      { pubkey: account.pubkey },
      `Profile ${account.pubkey.slice(0, 8)}...`,
    );
  }

  function login() {
    setShowLoginDialog(true);
  }

  function switchAccount(targetAccount: IAccount<ISigner, unknown, unknown>) {
    accounts.setActive(targetAccount.id);
  }

  function addAccount() {
    setShowLoginDialog(true);
  }

  async function logout() {
    if (!account) return;
    accounts.removeAccount(account);
  }

  return (
    <>
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <LoginDialog open={showLoginDialog} onOpenChange={setShowLoginDialog} />
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
              {/* Active Account */}
              <DropdownMenuGroup>
                <DropdownMenuLabel
                  className="cursor-crosshair hover:bg-muted/50"
                  onClick={openProfile}
                >
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-primary" />
                    <UserLabel account={account} />
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>

              {/* Other Accounts */}
              {otherAccounts.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                      Switch Account
                    </DropdownMenuLabel>
                    {otherAccounts.map((acc) => (
                      <DropdownMenuItem
                        key={acc.id}
                        onClick={() => switchAccount(acc)}
                        className="cursor-crosshair"
                      >
                        <UserLabel account={acc} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}

              {/* Add Account */}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={addAccount}
                className="cursor-crosshair"
              >
                <UserPlus className="mr-2 size-4" />
                Add account
              </DropdownMenuItem>

              {/* Relays */}
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

              {/* Logout */}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-crosshair">
                Log out
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={login}>Log in</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
