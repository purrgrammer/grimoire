import { useEffect } from "react";
import { toast } from "sonner";
import { Check, X, Info } from "lucide-react";
import type { ReadOnlyAccount } from "@/lib/account-types";
import accountManager from "@/services/accounts";

interface LoginHandlerProps {
  action: "add-account" | "error" | "open-dialog";
  account?: ReadOnlyAccount;
  message?: string;
}

/**
 * LoginHandler - Executes login command actions
 *
 * This component handles the result of the /login command:
 * - add-account: Adds account to AccountManager and sets as active
 * - error: Shows error toast
 * - open-dialog: Shows info about opening login dialog (UI coming soon)
 */
export default function LoginHandler({
  action,
  account,
  message,
}: LoginHandlerProps) {
  useEffect(() => {
    const handleAction = async () => {
      switch (action) {
        case "add-account":
          if (!account) {
            toast.error("Failed to add account", {
              description: "No account provided",
              icon: <X className="h-4 w-4" />,
            });
            return;
          }

          try {
            // Add account to manager
            accountManager.addAccount(account);

            // Set as active account
            accountManager.setActive(account.id);

            // Show success toast
            toast.success("Account added successfully", {
              description: `Logged in as ${account.pubkey.slice(0, 8)}...${account.pubkey.slice(-8)}`,
              icon: <Check className="h-4 w-4" />,
            });
          } catch (error) {
            toast.error("Failed to add account", {
              description:
                error instanceof Error ? error.message : "Unknown error",
              icon: <X className="h-4 w-4" />,
            });
          }
          break;

        case "error":
          toast.error("Login failed", {
            description: message || "Unknown error occurred",
            icon: <X className="h-4 w-4" />,
          });
          break;

        case "open-dialog":
          toast.info("Login dialog", {
            description:
              "Login dialog UI coming soon. For now, use: login <npub|nip-05|hex|nprofile>",
            icon: <Info className="h-4 w-4" />,
            duration: 5000,
          });
          break;

        default:
          toast.error("Unknown action", {
            description: `Unhandled action: ${action}`,
            icon: <X className="h-4 w-4" />,
          });
      }
    };

    handleAction();
  }, [action, account, message]);

  // This component doesn't render anything visible - it just executes the action
  return (
    <div className="flex items-center justify-center h-full w-full p-8">
      <div className="text-center text-muted-foreground space-y-2">
        <p className="text-sm">Processing login...</p>
        <p className="text-xs">This window can be closed.</p>
      </div>
    </div>
  );
}
