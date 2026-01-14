import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import {
  Package,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { firstValueFrom } from "rxjs";
import giftWrapManager from "@/services/gift-wrap";
import accountManager from "@/services/accounts";
import eventStore from "@/services/event-store";
import db, { DecryptedGiftWrap } from "@/services/db";

interface InboxViewerProps {
  action?: "decrypt-pending" | "clear-failed" | null;
}

export default function InboxViewer({ action }: InboxViewerProps) {
  const account = use$(accountManager.active$);
  const syncState = use$(giftWrapManager.state);
  const [decrypted, setDecrypted] = useState<DecryptedGiftWrap[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [decrypting, setDecrypting] = useState(false);

  const pubkey = account?.pubkey;

  // Load decrypted gift wraps from Dexie
  useEffect(() => {
    if (!pubkey) return;

    db.decryptedGiftWraps
      .orderBy("receivedAt")
      .reverse()
      .offset(page * 50)
      .limit(50)
      .toArray()
      .then(setDecrypted);
  }, [pubkey, page, syncState?.decryptedCount]);

  // Initial sync on mount
  useEffect(() => {
    if (!pubkey) return;

    const syncGiftWraps = async () => {
      setLoading(true);
      try {
        // Get DM relays from user's kind 10050 relay list (NIP-17)
        const dmRelayListEvent = await firstValueFrom(
          eventStore.replaceable({ kind: 10050, pubkey }),
        );

        // Kind 10050 uses read/write relay tags
        const dmRelays = dmRelayListEvent
          ? dmRelayListEvent.tags
              .filter((t) => t[0] === "relay" && (!t[2] || t[2] === "read"))
              .map((t) => t[1])
          : [];

        // Fallback to default relays if no DM relays configured
        const relays =
          dmRelays.length > 0
            ? dmRelays
            : [
                "wss://relay.damus.io",
                "wss://nos.lol",
                "wss://relay.nostr.band",
              ];

        await giftWrapManager.syncAll(pubkey, relays);

        // Subscribe to new gift wraps
        giftWrapManager.subscribeToNew(pubkey, relays);
      } catch (error) {
        console.error("[InboxViewer] Sync error:", error);
      } finally {
        setLoading(false);
      }
    };

    syncGiftWraps();

    return () => {
      giftWrapManager.unsubscribe(pubkey);
    };
  }, [pubkey]);

  // Handle action flags
  useEffect(() => {
    if (!action || !pubkey || !account) return;

    const handleAction = async () => {
      if (action === "decrypt-pending") {
        await handleDecryptAll();
      } else if (action === "clear-failed") {
        await giftWrapManager.clearErrors();
        await giftWrapManager.updateCounts(pubkey);
      }
    };

    handleAction();
  }, [action, pubkey, account]);

  const handleDecryptAll = async () => {
    if (!pubkey || !account) return;

    setDecrypting(true);
    try {
      // Get pending gift wrap events (returns array)
      const pendingEvents = await firstValueFrom(
        giftWrapManager.getPendingGiftWraps(pubkey),
      );

      // Extract IDs
      const pending = Array.isArray(pendingEvents)
        ? pendingEvents.map((e) => e.id)
        : [];

      if (pending.length === 0) {
        console.log("[InboxViewer] No pending gift wraps to decrypt");
        setDecrypting(false);
        return;
      }

      console.log(`[InboxViewer] Decrypting ${pending.length} gift wraps...`);

      // Decrypt batch
      for await (const result of giftWrapManager.decryptBatch(
        pending,
        account,
      )) {
        if (result.status === "success") {
          // Refresh decrypted list
          const updated = await db.decryptedGiftWraps
            .orderBy("receivedAt")
            .reverse()
            .offset(page * 50)
            .limit(50)
            .toArray();
          setDecrypted(updated);
        }
      }

      // Update counts
      await giftWrapManager.updateCounts(pubkey);
      console.log("[InboxViewer] Batch decrypt complete");
    } catch (error) {
      console.error("[InboxViewer] Decrypt error:", error);
    } finally {
      setDecrypting(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Clear all decrypted gift wraps? This cannot be undone.")) {
      return;
    }

    await giftWrapManager.clearDecrypted();
    setDecrypted([]);

    if (pubkey) {
      await giftWrapManager.updateCounts(pubkey);
    }
  };

  if (!account || !pubkey) {
    return (
      <div className="flex items-center justify-center h-full text-base-content/50">
        <div className="text-center space-y-4">
          <Package className="w-12 h-12 mx-auto opacity-50" />
          <p>No active account. Please login to view gift wraps.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with status */}
      <div className="flex flex-col gap-4 p-4 border-b border-base-300">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Package className="w-5 h-5" />
            Gift Wrap Inbox
          </h2>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-base-content/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              Syncing...
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 text-warning rounded-lg">
            <Package className="w-4 h-4" />
            <span className="font-medium">{syncState?.pendingCount ?? 0}</span>
            <span className="text-sm">Pending</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 bg-success/10 text-success rounded-lg">
            <CheckCircle2 className="w-4 h-4" />
            <span className="font-medium">
              {syncState?.decryptedCount ?? 0}
            </span>
            <span className="text-sm">Decrypted</span>
          </div>

          {(syncState?.failedCount ?? 0) > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-error/10 text-error rounded-lg">
              <AlertCircle className="w-4 h-4" />
              <span className="font-medium">{syncState?.failedCount}</span>
              <span className="text-sm">Failed</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleDecryptAll}
            disabled={decrypting || (syncState?.pendingCount ?? 0) === 0}
            className="btn btn-sm btn-primary"
          >
            {decrypting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Decrypting...
              </>
            ) : (
              <>Decrypt All Pending ({syncState?.pendingCount ?? 0})</>
            )}
          </button>

          {(syncState?.failedCount ?? 0) > 0 && (
            <button
              onClick={() => giftWrapManager.clearErrors()}
              className="btn btn-sm btn-ghost"
            >
              Clear Failed Attempts
            </button>
          )}

          {(syncState?.decryptedCount ?? 0) > 0 && (
            <button
              onClick={handleClearAll}
              className="btn btn-sm btn-ghost text-error"
            >
              <Trash2 className="w-4 h-4" />
              Clear All Decrypted
            </button>
          )}
        </div>
      </div>

      {/* Decrypted gift wraps list */}
      <div className="flex-1 overflow-y-auto">
        {decrypted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-base-content/50">
            <div className="text-center space-y-4">
              <Package className="w-12 h-12 mx-auto opacity-50" />
              <p>No decrypted gift wraps yet.</p>
              {(syncState?.pendingCount ?? 0) > 0 && (
                <button
                  onClick={handleDecryptAll}
                  disabled={decrypting}
                  className="btn btn-primary btn-sm"
                >
                  Decrypt {syncState?.pendingCount} Pending
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-base-300">
            {decrypted.map((wrap) => (
              <div key={wrap.giftWrapId} className="p-4 hover:bg-base-200/50">
                <div className="flex items-start gap-3">
                  <Package className="w-5 h-5 text-base-content/40 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">
                        Kind {wrap.rumor.kind}
                      </span>
                      {wrap.sealPubkey && (
                        <span className="text-xs text-base-content/60 font-mono">
                          from {wrap.sealPubkey.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-base-content/80 line-clamp-2">
                      {wrap.rumor.content.slice(0, 200)}
                      {wrap.rumor.content.length > 200 && "..."}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-base-content/60">
                      <span>
                        Received:{" "}
                        {new Date(wrap.receivedAt * 1000).toLocaleString()}
                      </span>
                      <span>
                        Decrypted:{" "}
                        {new Date(wrap.decryptedAt * 1000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more button */}
        {decrypted.length >= 50 && (
          <div className="p-4 text-center">
            <button
              onClick={() => setPage((p) => p + 1)}
              className="btn btn-sm btn-ghost"
            >
              Load More
            </button>
          </div>
        )}
      </div>

      {/* Footer with sync info */}
      {(syncState?.lastSyncAt ?? 0) > 0 && (
        <div className="p-2 text-xs text-center text-base-content/50 border-t border-base-300">
          Last synced: {new Date(syncState!.lastSyncAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
