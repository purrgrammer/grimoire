/**
 * Wallet State Components
 *
 * Shared components for common wallet states (no wallet, locked, etc.)
 */

import { ReactNode } from "react";
import { Wallet, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface NoWalletViewProps {
  /** Title to display */
  title?: string;
  /** Message to display */
  message: string;
  /** Action button */
  action?: ReactNode;
}

export function NoWalletView({
  title = "No Wallet Found",
  message,
  action,
}: NoWalletViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {action}
        </CardContent>
      </Card>
    </div>
  );
}

interface WalletLockedViewProps {
  /** Message to display */
  message?: string;
  /** Whether unlock is in progress */
  loading: boolean;
  /** Unlock button handler */
  onUnlock: () => void;
}

export function WalletLockedView({
  message = "Your wallet is locked. Unlock it to view your balance and history.",
  loading,
  onUnlock,
}: WalletLockedViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-5" />
            Wallet Locked
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button onClick={onUnlock} disabled={loading} className="w-full">
            {loading ? (
              <>
                <RefreshCw className="mr-2 size-4 animate-spin" />
                Unlocking...
              </>
            ) : (
              <>
                <Lock className="mr-2 size-4" />
                Unlock Wallet
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

interface WalletErrorViewProps {
  /** Error message */
  message: string;
  /** Retry handler */
  onRetry?: () => void;
}

export function WalletErrorView({ message, onRetry }: WalletErrorViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Wallet className="size-5" />
            Wallet Error
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {onRetry && (
            <Button onClick={onRetry} variant="outline" className="w-full">
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
