import { User, Check, UserPlus } from "lucide-react";
import accounts from "@/services/accounts";
import { ExtensionSigner } from "applesauce-signers";
import { ExtensionAccount } from "applesauce-accounts/accounts";
import { useProfile } from "@/hooks/useProfile";
import { useObservableMemo } from "applesauce-react/hooks";
import { getDisplayName } from "@/lib/nostr-utils";
import { useGrimoire } from "@/core/state";
import { useAppShell } from "@/components/layouts/AppShellContext";
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
import { useState } from "react";
import type { IAccount } from "applesauce-accounts";

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
  const account = useObservableMemo(() => accounts.active$, []);
  const allAccounts = useObservableMemo(() => accounts.accounts$, []);
  const { state, addWindow } = useGrimoire();
  const { openCommandLauncher } = useAppShell();
  const relays = state.activeAccount?.relays;
  const [showSettings, setShowSettings] = useState(false);

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

  async function login() {
    try {
      const signer = new ExtensionSigner();
      const pubkey = await signer.getPublicKey();
      const account = new ExtensionAccount(pubkey, signer);
      accounts.addAccount(account);
      accounts.setActive(account);
    } catch (err) {
      console.error(err);
    }
  }

  function switchAccount(targetAccount: IAccount<any, any, any>) {
    accounts.setActive(targetAccount.id);
  }

  function addAccount() {
    // Open the command launcher (user will type "login" command)
    openCommandLauncher();
  }

  async function logout() {
    if (!account) return;
    accounts.removeAccount(account);
  }

  return (
    <>
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
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
              <User onClick={login} className="size-4 text-muted-foreground" />
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
                    <UserLabel pubkey={account.pubkey} />
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
                        <div className="flex items-center gap-2">
                          <UserAvatar pubkey={acc.pubkey} />
                          <UserLabel pubkey={acc.pubkey} />
                        </div>
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
