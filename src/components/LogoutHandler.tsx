import { useEffect } from "react";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import accountManager from "@/services/accounts";
import { useObservableMemo } from "applesauce-react/hooks";

interface LogoutHandlerProps {
  action: "logout" | "logout-all";
  all: boolean;
}

/**
 * LogoutHandler - Executes logout command actions
 *
 * This component handles the result of the /logout command:
 * - logout: Removes the active account
 * - logout-all: Removes all accounts
 */
export default function LogoutHandler({ action, all }: LogoutHandlerProps) {
  const activeAccount = useObservableMemo(() => accountManager.active$, []);
  const allAccounts = useObservableMemo(() => accountManager.accounts$, []);

  useEffect(() => {
    const handleLogout = () => {
      if (action === "logout-all" || all) {
        // Remove all accounts
        if (allAccounts.length === 0) {
          toast.info("No accounts to remove", {
            icon: <LogOut className="h-4 w-4" />,
          });
          return;
        }

        const confirmLogoutAll = window.confirm(
          `Remove all ${allAccounts.length} account(s)? This cannot be undone.`,
        );

        if (!confirmLogoutAll) {
          toast.info("Logout cancelled", {
            icon: <LogOut className="h-4 w-4" />,
          });
          return;
        }

        // Remove all accounts
        allAccounts.forEach((account) => {
          accountManager.removeAccount(account);
        });

        toast.success("All accounts removed", {
          description: `Removed ${allAccounts.length} account(s)`,
          icon: <LogOut className="h-4 w-4" />,
        });
      } else {
        // Remove only active account
        if (!activeAccount) {
          toast.info("No active account to remove", {
            description: "You are not logged in",
            icon: <LogOut className="h-4 w-4" />,
          });
          return;
        }

        accountManager.removeAccount(activeAccount);

        toast.success("Logged out", {
          description: `Removed ${activeAccount.pubkey.slice(0, 8)}...${activeAccount.pubkey.slice(-8)}`,
          icon: <LogOut className="h-4 w-4" />,
        });
      }
    };

    handleLogout();
  }, [action, all, activeAccount, allAccounts]);

  // This component doesn't render anything visible - it just executes the action
  return (
    <div className="flex items-center justify-center h-full w-full p-8">
      <div className="text-center text-muted-foreground space-y-2">
        <LogOut className="size-8 mx-auto mb-4 opacity-20" />
        <p className="text-sm">Processing logout...</p>
        <p className="text-xs">This window can be closed.</p>
      </div>
    </div>
  );
}
