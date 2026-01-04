import { useObservableMemo } from "applesauce-react/hooks";
import { Check, User, UserX, UserPlus } from "lucide-react";
import { toast } from "sonner";
import accountManager from "@/services/accounts";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { useAppShell } from "@/components/layouts/AppShellContext";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Nip05 from "@/components/nostr/nip05";
import type { IAccount } from "applesauce-accounts";
import type { ISigner } from "applesauce-signers";

function AccountCard({
  account,
  isActive,
}: {
  account: IAccount<ISigner, unknown, unknown>;
  isActive: boolean;
}) {
  const profile = useProfile(account.pubkey);
  const displayName = getDisplayName(account.pubkey, profile);

  const handleSwitch = () => {
    accountManager.setActive(account.id);
    toast.success("Switched account", {
      description: `Now using ${displayName}`,
    });
  };

  const handleRemove = () => {
    const confirmRemove = window.confirm(
      `Remove account ${displayName}? This cannot be undone.`,
    );
    if (confirmRemove) {
      accountManager.removeAccount(account);
      toast.success("Account removed", {
        description: `Removed ${displayName}`,
      });
    }
  };

  return (
    <Card className={isActive ? "border-primary" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            {isActive && (
              <Check className="size-4 text-primary flex-shrink-0" />
            )}
            <Avatar className="size-10">
              <AvatarImage src={profile?.picture} alt={displayName} />
              <AvatarFallback>
                <User className="size-5" />
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{displayName}</div>
              {profile && (
                <div className="text-xs text-muted-foreground">
                  <Nip05 pubkey={account.pubkey} profile={profile} />
                </div>
              )}
              <div className="text-xs text-muted-foreground font-mono truncate">
                {account.pubkey.slice(0, 8)}...{account.pubkey.slice(-8)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isActive && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSwitch}
                className="cursor-crosshair"
              >
                Switch
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              className="cursor-crosshair text-destructive hover:text-destructive"
              title="Remove account"
            >
              <UserX className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * AccountManager - Shows all accounts with management actions
 */
export default function AccountManager() {
  const activeAccount = useObservableMemo(() => accountManager.active$, []);
  const allAccounts = useObservableMemo(() => accountManager.accounts$, []);
  const { openCommandLauncher } = useAppShell();

  const handleAddAccount = () => {
    openCommandLauncher();
  };

  return (
    <div className="h-full w-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Accounts</span>
              <Button
                size="sm"
                onClick={handleAddAccount}
                className="cursor-crosshair"
              >
                <UserPlus className="size-4 mr-2" />
                Add Account
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allAccounts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="size-12 mx-auto mb-4 opacity-20" />
                <p className="text-sm">No accounts yet</p>
                <p className="text-xs mt-2">
                  Use the "Add Account" button or type{" "}
                  <code className="text-xs px-1 py-0.5 bg-muted rounded">
                    login
                  </code>{" "}
                  in the command launcher
                </p>
              </div>
            ) : (
              allAccounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  isActive={account.id === activeAccount?.id}
                />
              ))
            )}
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground text-center">
          <p>
            Tip: You can also switch accounts from the user menu in the
            top-right corner
          </p>
        </div>
      </div>
    </div>
  );
}
