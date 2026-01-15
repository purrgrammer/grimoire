import { useState, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Mail,
  Settings,
  Lock,
  Unlock,
  Loader2,
  CheckCircle,
  XCircle,
  MessageSquare,
  Radio,
  Database,
} from "lucide-react";
import { useGrimoire } from "@/core/state";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import giftWrapLoader from "@/services/gift-wrap-loader";
import { getConversations } from "@/services/gift-wrap";
import db from "@/services/db";
import { toast } from "sonner";
import { use$ } from "applesauce-react/hooks";
import accounts from "@/services/accounts";
import { useProfile } from "@/hooks/useProfile";
import { getDisplayName } from "@/lib/nostr-utils";
import { formatDistanceToNow } from "date-fns";

export function InboxViewer() {
  const { state, setPrivateMessagesEnabled, setAutoDecryptGiftWraps } =
    useGrimoire();
  const activeAccount = use$(accounts.active$);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptResult, setDecryptResult] = useState<{
    success: number;
    failed: number;
    total: number;
  } | null>(null);

  // Get settings
  const privateMessagesEnabled = state.privateMessagesEnabled ?? false;
  const autoDecrypt = state.autoDecryptGiftWraps ?? false;

  // Get pending count
  const pendingCount = useLiveQuery(async () => {
    if (!activeAccount?.pubkey) return 0;
    return giftWrapLoader.getPendingCount(activeAccount.pubkey);
  }, [activeAccount?.pubkey]);

  // Get conversation count
  const conversationCount = useLiveQuery(async () => {
    if (!activeAccount?.pubkey) return 0;
    return giftWrapLoader.getConversationCount(activeAccount.pubkey);
  }, [activeAccount?.pubkey]);

  // Get unread count
  const unreadCount = useLiveQuery(async () => {
    if (!activeAccount?.pubkey) return 0;
    return giftWrapLoader.getUnreadCount(activeAccount.pubkey);
  }, [activeAccount?.pubkey]);

  // Get conversations
  const conversations = useLiveQuery(async () => {
    if (!activeAccount?.pubkey) return [];
    return getConversations(activeAccount.pubkey);
  }, [activeAccount?.pubkey]);

  // Get decrypted messages count
  const decryptedCount = useLiveQuery(async () => {
    if (!activeAccount?.pubkey) return 0;
    return db.decryptedRumors
      .where("recipientPubkey")
      .equals(activeAccount.pubkey)
      .count();
  }, [activeAccount?.pubkey]);

  // Get loader state for relay info
  const [loaderState, setLoaderState] = useState<any>(null);

  // Subscribe to loader state
  useEffect(() => {
    const subscription = giftWrapLoader.state.subscribe(setLoaderState);
    return () => subscription.unsubscribe();
  }, []);

  const handleTogglePrivateMessages = (enabled: boolean) => {
    setPrivateMessagesEnabled(enabled);

    if (enabled) {
      toast.success("Private messages enabled");
    } else {
      toast.info("Private messages disabled");
    }
  };

  const handleToggleAutoDecrypt = (enabled: boolean) => {
    setAutoDecryptGiftWraps(enabled);

    if (enabled) {
      toast.success("Auto-decrypt enabled");
    } else {
      toast.info("Auto-decrypt disabled");
    }
  };

  const handleDecryptPending = async () => {
    setIsDecrypting(true);
    setDecryptResult(null);

    try {
      const result = await giftWrapLoader.decryptPending();
      setDecryptResult(result);

      if (result.success > 0) {
        toast.success(
          `Decrypted ${result.success} message${result.success === 1 ? "" : "s"}`,
        );
      }

      if (result.failed > 0) {
        toast.error(
          `Failed to decrypt ${result.failed} message${result.failed === 1 ? "" : "s"}`,
        );
      }

      if (result.total === 0) {
        toast.info("No pending messages to decrypt");
      }
    } catch (error) {
      console.error("Failed to decrypt pending messages:", error);
      toast.error("Failed to decrypt pending messages");
    } finally {
      setIsDecrypting(false);
    }
  };

  if (!activeAccount) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Lock className="h-12 w-12 mb-4 text-muted-foreground" />
        <h2 className="text-xl font-semibold mb-2">No Active Account</h2>
        <p className="text-muted-foreground">
          Sign in to view your private messages
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Private Messages</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Conversations
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{conversationCount ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Decrypted
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{decryptedCount ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Unread
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{unreadCount ?? 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pending
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">{pendingCount ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Settings */}
        <Card>
          <CardHeader className="p-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <CardTitle className="text-base">Settings</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-4">
            {/* Enable Private Messages */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="enable-private-messages"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Enable Private Messages
                </label>
                <p className="text-sm text-muted-foreground">
                  Fetch and store encrypted gift wraps from DM relays
                </p>
              </div>
              <Switch
                id="enable-private-messages"
                checked={privateMessagesEnabled}
                onCheckedChange={handleTogglePrivateMessages}
              />
            </div>

            {/* Auto-Decrypt */}
            {privateMessagesEnabled && (
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="auto-decrypt"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    Auto-Decrypt Messages
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Automatically decrypt gift wraps as they arrive
                  </p>
                </div>
                <Switch
                  id="auto-decrypt"
                  checked={autoDecrypt}
                  onCheckedChange={handleToggleAutoDecrypt}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manual Decrypt */}
        {privateMessagesEnabled && !autoDecrypt && (pendingCount ?? 0) > 0 && (
          <Card>
            <CardHeader className="p-4">
              <div className="flex items-center gap-2">
                <Unlock className="h-4 w-4" />
                <CardTitle className="text-base">Pending Messages</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                You have {pendingCount} encrypted message
                {pendingCount === 1 ? "" : "s"} waiting to be decrypted.
              </p>

              <Button
                onClick={handleDecryptPending}
                disabled={isDecrypting}
                className="w-full"
              >
                {isDecrypting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Decrypting...
                  </>
                ) : (
                  <>
                    <Unlock className="mr-2 h-4 w-4" />
                    Decrypt Pending Messages
                  </>
                )}
              </Button>

              {decryptResult && (
                <div className="space-y-2">
                  {decryptResult.success > 0 && (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      <span>
                        {decryptResult.success} message
                        {decryptResult.success === 1 ? "" : "s"} decrypted
                      </span>
                    </div>
                  )}
                  {decryptResult.failed > 0 && (
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                      <XCircle className="h-4 w-4" />
                      <span>
                        {decryptResult.failed} message
                        {decryptResult.failed === 1 ? "" : "s"} failed
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Status */}
        {privateMessagesEnabled && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm">
                <div
                  className={`h-2 w-2 rounded-full ${
                    privateMessagesEnabled
                      ? "bg-green-500"
                      : "bg-muted-foreground"
                  }`}
                />
                <span className="text-muted-foreground">
                  {privateMessagesEnabled
                    ? autoDecrypt
                      ? "Auto-decrypt enabled - messages will be decrypted automatically"
                      : "Manual decrypt - messages will be queued for manual decryption"
                    : "Private messages disabled"}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Relay Status */}
        {privateMessagesEnabled &&
          loaderState?.relays &&
          loaderState.relays.length > 0 && (
            <Card>
              <CardHeader className="p-4">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4" />
                  <CardTitle className="text-base">DM Relays</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-1">
                  {loaderState.relays.map((relay: string) => (
                    <div
                      key={relay}
                      className="text-sm font-mono text-muted-foreground flex items-center gap-2"
                    >
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      {relay}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Debug Info */}
        {privateMessagesEnabled && (
          <Card>
            <CardHeader className="p-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                <CardTitle className="text-base">Debug Info</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-2">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loader Enabled:</span>
                  <span className="font-mono">
                    {loaderState?.enabled ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Auto-Decrypt:</span>
                  <span className="font-mono">
                    {loaderState?.autoDecrypt ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loading:</span>
                  <span className="font-mono">
                    {loaderState?.loading ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Error Count:</span>
                  <span className="font-mono">
                    {loaderState?.errorCount ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Sync:</span>
                  <span className="font-mono text-xs">
                    {loaderState?.lastSync
                      ? formatDistanceToNow(loaderState.lastSync, {
                          addSuffix: true,
                        })
                      : "Never"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Conversations List */}
        {privateMessagesEnabled &&
          conversations &&
          conversations.length > 0 && (
            <Card>
              <CardHeader className="p-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <CardTitle className="text-base">Conversations</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-2">
                  {conversations.map((conv) => (
                    <ConversationItem key={conv.id} conversation={conv} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Help Text */}
        {!privateMessagesEnabled && (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Private messages use NIP-59 gift wraps to provide
              metadata-obscured messaging.
            </p>
            <p>
              Messages are fetched from your DM relays (NIP-17: kind 10050) and
              encrypted with NIP-44.
            </p>
            <p>
              Enable private messages above to start receiving encrypted
              messages.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationItem({ conversation }: { conversation: any }) {
  const profile = useProfile(conversation.senderPubkey);
  const displayName = getDisplayName(conversation.senderPubkey, profile);

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <div className="font-medium truncate">{displayName}</div>
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(conversation.lastMessageCreatedAt * 1000, {
              addSuffix: true,
            })}
          </div>
        </div>
        <div className="text-sm text-muted-foreground truncate">
          {conversation.lastMessagePreview}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">
            {conversation.messageCount} message
            {conversation.messageCount === 1 ? "" : "s"}
          </span>
          {conversation.unreadCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
              {conversation.unreadCount} new
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
