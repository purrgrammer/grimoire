import { User, Circle } from "lucide-react";
import accounts from "@/services/accounts";
import { ExtensionSigner } from "applesauce-signers";
import { ExtensionAccount } from "applesauce-accounts/accounts";
import { useProfile } from "@/hooks/useProfile";
import { useObservableMemo } from "applesauce-react/hooks";
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
  const { state, addWindow } = useGrimoire();
  const relays = state.activeAccount?.relays;

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

  async function logout() {
    if (!account) return;
    accounts.removeAccount(account);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="link">
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
            <DropdownMenuGroup>
              <DropdownMenuLabel
                className="cursor-pointer hover:bg-muted/50"
                onClick={openProfile}
              >
                <UserLabel pubkey={account.pubkey} />
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            {relays && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Inbox Relays
                  </DropdownMenuLabel>
                  {relays.inbox.length > 0 ? (
                    relays.inbox.map((relay) => (
                      <div
                        key={relay.url}
                        className="flex items-center gap-2 px-2 py-1"
                      >
                        <Circle className="size-2 fill-green-500 text-green-500" />
                        <span className="text-xs font-mono text-muted-foreground truncate">
                          {relay.url}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="px-2 py-1 text-xs text-muted-foreground italic">
                      No inbox relays configured
                    </div>
                  )}
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                    Outbox Relays
                  </DropdownMenuLabel>
                  {relays.outbox.length > 0 ? (
                    relays.outbox.map((relay) => (
                      <div
                        key={relay.url}
                        className="flex items-center gap-2 px-2 py-1"
                      >
                        <Circle className="size-2 fill-green-500 text-green-500" />
                        <span className="text-xs font-mono text-muted-foreground truncate">
                          {relay.url}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="px-2 py-1 text-xs text-muted-foreground italic">
                      No outbox relays configured
                    </div>
                  )}
                </DropdownMenuGroup>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>Log out</DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={login}>Log in</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
