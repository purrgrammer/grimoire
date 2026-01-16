/**
 * Moderation Section
 *
 * Manage pubkey bans/allows and event moderation.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Loader2,
  Trash2,
  UserX,
  UserCheck,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  FileX,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserName } from "@/components/nostr/UserName";
import { KindBadge } from "@/components/KindBadge";
import type {
  Nip86Client,
  PubkeyEntry,
  EventEntry,
  ModerationQueueEntry,
} from "@/lib/nip86-client";
import { BatchConfirmDialog } from "./ConfirmActionDialog";
import eventStore from "@/services/event-store";
import { eventLoader } from "@/services/loaders";
import type { NostrEvent } from "nostr-tools/core";

interface ModerationSectionProps {
  url: string;
  getClient: () => Nip86Client | null;
  supportedMethods: string[];
}

export function ModerationSection({
  url,
  getClient,
  supportedMethods,
}: ModerationSectionProps) {
  // Capability checks
  const canBanPubkey = supportedMethods.includes("banpubkey");
  const canListBannedPubkeys = supportedMethods.includes("listbannedpubkeys");
  const canAllowPubkey = supportedMethods.includes("allowpubkey");
  const canListAllowedPubkeys = supportedMethods.includes("listallowedpubkeys");
  const canListModQueue = supportedMethods.includes(
    "listeventsneedingmoderation",
  );
  const canAllowEvent = supportedMethods.includes("allowevent");
  const canBanEvent = supportedMethods.includes("banevent");
  const canListBannedEvents = supportedMethods.includes("listbannedevents");

  // State for each list
  const [bannedPubkeys, setBannedPubkeys] = useState<PubkeyEntry[]>([]);
  const [allowedPubkeys, setAllowedPubkeys] = useState<PubkeyEntry[]>([]);
  const [moderationQueue, setModerationQueue] = useState<
    ModerationQueueEntry[]
  >([]);
  const [bannedEvents, setBannedEvents] = useState<EventEntry[]>([]);

  // Event cache for previews
  const [eventCache, setEventCache] = useState<Record<string, NostrEvent>>({});

  // Loading states
  const [loadingBanned, setLoadingBanned] = useState(false);
  const [loadingAllowed, setLoadingAllowed] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingBannedEvents, setLoadingBannedEvents] = useState(false);

  // Loaded flags
  const [loadedBanned, setLoadedBanned] = useState(false);
  const [loadedAllowed, setLoadedAllowed] = useState(false);
  const [loadedQueue, setLoadedQueue] = useState(false);
  const [loadedBannedEvents, setLoadedBannedEvents] = useState(false);

  // Add form state
  const [newPubkey, setNewPubkey] = useState("");
  const [newReason, setNewReason] = useState("");
  const [addingPubkey, setAddingPubkey] = useState(false);

  // Selection states
  const [selectedBannedPubkeys, setSelectedBannedPubkeys] = useState<
    Set<string>
  >(new Set());
  const [_selectedAllowedPubkeys, setSelectedAllowedPubkeys] = useState<
    Set<string>
  >(new Set());
  const [selectedQueueEvents, setSelectedQueueEvents] = useState<Set<string>>(
    new Set(),
  );
  const [_selectedBannedEvents, setSelectedBannedEvents] = useState<
    Set<string>
  >(new Set());

  // Dialog states
  const [_showBanDialog, _setShowBanDialog] = useState(false);
  const [showUnbanDialog, setShowUnbanDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [_pubkeyToAction, _setPubkeyToAction] = useState<{
    pubkey: string;
    action: "ban" | "unban" | "remove";
  } | null>(null);
  const [_eventToAction, _setEventToAction] = useState<{
    id: string;
    action: "approve" | "ban" | "unban";
  } | null>(null);

  // Parse pubkey input (supports npub, hex, nprofile)
  const parsePubkeyInput = (input: string): string | null => {
    const trimmed = input.trim();

    // Try hex
    if (/^[0-9a-f]{64}$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    // Try bech32
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") {
        return decoded.data;
      }
      if (decoded.type === "nprofile") {
        return decoded.data.pubkey;
      }
    } catch {
      // Not a valid bech32
    }

    return null;
  };

  // Fetch events for preview
  const fetchEventPreviews = useCallback(
    async (eventIds: string[]) => {
      const newCache: Record<string, NostrEvent> = { ...eventCache };

      for (const id of eventIds) {
        if (newCache[id]) continue;

        // First check if already in store
        const existing = eventStore.getEvent(id);
        if (existing) {
          newCache[id] = existing;
          continue;
        }

        // Try to fetch from the relay we're administering
        try {
          eventLoader({ id, relays: [url] }).subscribe({
            next: (event) => {
              if (event) {
                setEventCache((prev) => ({ ...prev, [event.id]: event }));
              }
            },
          });
        } catch {
          // Ignore fetch errors
        }
      }

      setEventCache(newCache);
    },
    [eventCache, url],
  );

  // Fetch functions
  const fetchBannedPubkeys = useCallback(async () => {
    const client = getClient();
    if (!client || !canListBannedPubkeys) return;

    setLoadingBanned(true);
    try {
      const result = await client.listBannedPubkeys();
      setBannedPubkeys(result);
      setLoadedBanned(true);
      setSelectedBannedPubkeys(new Set());
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to fetch banned pubkeys",
      );
    } finally {
      setLoadingBanned(false);
    }
  }, [getClient, canListBannedPubkeys]);

  const fetchAllowedPubkeys = useCallback(async () => {
    const client = getClient();
    if (!client || !canListAllowedPubkeys) return;

    setLoadingAllowed(true);
    try {
      const result = await client.listAllowedPubkeys();
      setAllowedPubkeys(result);
      setLoadedAllowed(true);
      setSelectedAllowedPubkeys(new Set());
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to fetch allowed pubkeys",
      );
    } finally {
      setLoadingAllowed(false);
    }
  }, [getClient, canListAllowedPubkeys]);

  const fetchModerationQueue = useCallback(async () => {
    const client = getClient();
    if (!client || !canListModQueue) return;

    setLoadingQueue(true);
    try {
      const result = await client.listEventsNeedingModeration();
      setModerationQueue(result);
      setLoadedQueue(true);
      setSelectedQueueEvents(new Set());

      // Fetch event previews
      if (result.length > 0) {
        fetchEventPreviews(result.map((e) => e.id));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to fetch moderation queue",
      );
    } finally {
      setLoadingQueue(false);
    }
  }, [getClient, canListModQueue, fetchEventPreviews]);

  const fetchBannedEvents = useCallback(async () => {
    const client = getClient();
    if (!client || !canListBannedEvents) return;

    setLoadingBannedEvents(true);
    try {
      const result = await client.listBannedEvents();
      setBannedEvents(result);
      setLoadedBannedEvents(true);
      setSelectedBannedEvents(new Set());

      // Fetch event previews
      if (result.length > 0) {
        fetchEventPreviews(result.map((e) => e.id));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to fetch banned events",
      );
    } finally {
      setLoadingBannedEvents(false);
    }
  }, [getClient, canListBannedEvents, fetchEventPreviews]);

  // Action handlers
  const handleBanPubkey = async () => {
    const client = getClient();
    const pubkey = parsePubkeyInput(newPubkey);
    if (!client || !canBanPubkey || !pubkey) return;

    setAddingPubkey(true);
    try {
      await client.banPubkey(pubkey, newReason.trim() || undefined);
      toast.success("Pubkey banned");
      setNewPubkey("");
      setNewReason("");
      if (loadedBanned) await fetchBannedPubkeys();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to ban pubkey",
      );
    } finally {
      setAddingPubkey(false);
    }
  };

  const handleAllowPubkey = async () => {
    const client = getClient();
    const pubkey = parsePubkeyInput(newPubkey);
    if (!client || !canAllowPubkey || !pubkey) return;

    setAddingPubkey(true);
    try {
      await client.allowPubkey(pubkey, newReason.trim() || undefined);
      toast.success("Pubkey allowed");
      setNewPubkey("");
      setNewReason("");
      if (loadedAllowed) await fetchAllowedPubkeys();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to allow pubkey",
      );
    } finally {
      setAddingPubkey(false);
    }
  };

  const handleUnbanPubkey = async (pubkey: string) => {
    const client = getClient();
    if (!client || !canAllowPubkey) return;

    try {
      await client.allowPubkey(pubkey);
      toast.success("Pubkey unbanned");
      setBannedPubkeys((prev) => prev.filter((p) => p.pubkey !== pubkey));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to unban pubkey",
      );
    }
  };

  const handleBatchUnban = async () => {
    const client = getClient();
    if (!client || !canAllowPubkey) return;

    let successCount = 0;
    for (const pubkey of selectedBannedPubkeys) {
      try {
        await client.allowPubkey(pubkey);
        successCount++;
      } catch {
        // Continue with others
      }
    }

    if (successCount > 0) {
      toast.success(`Unbanned ${successCount} pubkey(s)`);
      await fetchBannedPubkeys();
    }
  };

  const handleApproveEvent = async (eventId: string) => {
    const client = getClient();
    if (!client || !canAllowEvent) return;

    try {
      await client.allowEvent(eventId);
      toast.success("Event approved");
      setModerationQueue((prev) => prev.filter((e) => e.id !== eventId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to approve event",
      );
    }
  };

  const handleBanEventFromQueue = async (eventId: string) => {
    const client = getClient();
    if (!client || !canBanEvent) return;

    try {
      await client.banEvent(eventId);
      toast.success("Event banned");
      setModerationQueue((prev) => prev.filter((e) => e.id !== eventId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to ban event",
      );
    }
  };

  const handleBatchApprove = async () => {
    const client = getClient();
    if (!client || !canAllowEvent) return;

    let successCount = 0;
    for (const eventId of selectedQueueEvents) {
      try {
        await client.allowEvent(eventId);
        successCount++;
      } catch {
        // Continue
      }
    }

    if (successCount > 0) {
      toast.success(`Approved ${successCount} event(s)`);
      await fetchModerationQueue();
    }
  };

  const handleBatchReject = async () => {
    const client = getClient();
    if (!client || !canBanEvent) return;

    let successCount = 0;
    for (const eventId of selectedQueueEvents) {
      try {
        await client.banEvent(eventId);
        successCount++;
      } catch {
        // Continue
      }
    }

    if (successCount > 0) {
      toast.success(`Rejected ${successCount} event(s)`);
      await fetchModerationQueue();
    }
  };

  // Render event preview
  const renderEventPreview = (eventId: string) => {
    const event = eventCache[eventId];
    if (!event) {
      return (
        <span className="font-mono text-xs text-muted-foreground truncate">
          {eventId.slice(0, 8)}...{eventId.slice(-8)}
        </span>
      );
    }

    return (
      <div className="flex items-center gap-2 min-w-0">
        <KindBadge kind={event.kind} variant="compact" className="shrink-0" />
        <UserName pubkey={event.pubkey} className="shrink-0 text-xs" />
        <span className="text-xs text-muted-foreground truncate">
          {event.content.slice(0, 50)}
          {event.content.length > 50 ? "..." : ""}
        </span>
      </div>
    );
  };

  // Determine which tabs to show
  const showPubkeyTab =
    canBanPubkey ||
    canListBannedPubkeys ||
    canAllowPubkey ||
    canListAllowedPubkeys;
  const showEventsTab =
    canListModQueue || canAllowEvent || canBanEvent || canListBannedEvents;

  return (
    <div className="space-y-4">
      <Tabs defaultValue={showPubkeyTab ? "pubkeys" : "events"}>
        <TabsList>
          {showPubkeyTab && <TabsTrigger value="pubkeys">Pubkeys</TabsTrigger>}
          {showEventsTab && <TabsTrigger value="events">Events</TabsTrigger>}
        </TabsList>

        {/* Pubkeys Tab */}
        {showPubkeyTab && (
          <TabsContent value="pubkeys" className="space-y-4">
            {/* Add Pubkey Form */}
            {(canBanPubkey || canAllowPubkey) && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Add Pubkey to Ban/Allow List
                </label>
                <div className="flex gap-2">
                  <Input
                    value={newPubkey}
                    onChange={(e) => setNewPubkey(e.target.value)}
                    placeholder="npub or hex pubkey"
                    className="flex-1"
                  />
                  <Input
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    placeholder="Reason (optional)"
                    className="flex-1"
                  />
                </div>
                <div className="flex gap-2">
                  {canBanPubkey && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleBanPubkey}
                      disabled={addingPubkey || !parsePubkeyInput(newPubkey)}
                    >
                      {addingPubkey ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : (
                        <UserX className="size-4 mr-2" />
                      )}
                      Ban
                    </Button>
                  )}
                  {canAllowPubkey && (
                    <Button
                      size="sm"
                      onClick={handleAllowPubkey}
                      disabled={addingPubkey || !parsePubkeyInput(newPubkey)}
                    >
                      {addingPubkey ? (
                        <Loader2 className="size-4 animate-spin mr-2" />
                      ) : (
                        <UserCheck className="size-4 mr-2" />
                      )}
                      Allow
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Banned Pubkeys */}
            {canListBannedPubkeys && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <UserX className="size-4 text-destructive" />
                    Banned Pubkeys
                    {loadedBanned && ` (${bannedPubkeys.length})`}
                  </label>
                  <div className="flex gap-2">
                    {selectedBannedPubkeys.size > 0 && canAllowPubkey && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowUnbanDialog(true)}
                      >
                        Unban {selectedBannedPubkeys.size} selected
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchBannedPubkeys}
                      disabled={loadingBanned}
                    >
                      {loadingBanned ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {loadedBanned && bannedPubkeys.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {bannedPubkeys.map((entry) => (
                      <div
                        key={entry.pubkey}
                        className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                      >
                        {canAllowPubkey && (
                          <Checkbox
                            checked={selectedBannedPubkeys.has(entry.pubkey)}
                            onCheckedChange={() => {
                              setSelectedBannedPubkeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(entry.pubkey)) {
                                  next.delete(entry.pubkey);
                                } else {
                                  next.add(entry.pubkey);
                                }
                                return next;
                              });
                            }}
                          />
                        )}
                        <UserName
                          pubkey={entry.pubkey}
                          className="flex-1 truncate"
                        />
                        {entry.reason && (
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {entry.reason}
                          </span>
                        )}
                        {canAllowPubkey && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() => handleUnbanPubkey(entry.pubkey)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {loadedBanned && bannedPubkeys.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">
                    No banned pubkeys
                  </div>
                )}
              </div>
            )}

            {/* Allowed Pubkeys */}
            {canListAllowedPubkeys && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <UserCheck className="size-4 text-green-500" />
                    Allowed Pubkeys
                    {loadedAllowed && ` (${allowedPubkeys.length})`}
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchAllowedPubkeys}
                    disabled={loadingAllowed}
                  >
                    {loadingAllowed ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                  </Button>
                </div>

                {loadedAllowed && allowedPubkeys.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {allowedPubkeys.map((entry) => (
                      <div
                        key={entry.pubkey}
                        className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                      >
                        <UserName
                          pubkey={entry.pubkey}
                          className="flex-1 truncate"
                        />
                        {entry.reason && (
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                            {entry.reason}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {loadedAllowed && allowedPubkeys.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">
                    No allowed pubkeys (relay may be public)
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        )}

        {/* Events Tab */}
        {showEventsTab && (
          <TabsContent value="events" className="space-y-4">
            {/* Moderation Queue */}
            {canListModQueue && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <ShieldAlert className="size-4 text-yellow-500" />
                    Moderation Queue
                    {loadedQueue && ` (${moderationQueue.length})`}
                  </label>
                  <div className="flex gap-2">
                    {selectedQueueEvents.size > 0 && (
                      <>
                        {canAllowEvent && (
                          <Button
                            size="sm"
                            onClick={() => setShowApproveDialog(true)}
                          >
                            <ShieldCheck className="size-4 mr-1" />
                            Approve {selectedQueueEvents.size}
                          </Button>
                        )}
                        {canBanEvent && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setShowRejectDialog(true)}
                          >
                            <ShieldX className="size-4 mr-1" />
                            Reject {selectedQueueEvents.size}
                          </Button>
                        )}
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchModerationQueue}
                      disabled={loadingQueue}
                    >
                      {loadingQueue ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {loadedQueue && moderationQueue.length > 0 && (
                  <div className="space-y-1 max-h-[250px] overflow-y-auto">
                    {moderationQueue.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedQueueEvents.has(entry.id)}
                          onCheckedChange={() => {
                            setSelectedQueueEvents((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.id)) {
                                next.delete(entry.id);
                              } else {
                                next.add(entry.id);
                              }
                              return next;
                            });
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          {renderEventPreview(entry.id)}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {canAllowEvent && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => handleApproveEvent(entry.id)}
                            >
                              <ShieldCheck className="size-3 text-green-500" />
                            </Button>
                          )}
                          {canBanEvent && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => handleBanEventFromQueue(entry.id)}
                            >
                              <ShieldX className="size-3 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {loadedQueue && moderationQueue.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">
                    No events pending moderation
                  </div>
                )}
              </div>
            )}

            {/* Banned Events */}
            {canListBannedEvents && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <FileX className="size-4 text-destructive" />
                    Banned Events
                    {loadedBannedEvents && ` (${bannedEvents.length})`}
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchBannedEvents}
                    disabled={loadingBannedEvents}
                  >
                    {loadingBannedEvents ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                  </Button>
                </div>

                {loadedBannedEvents && bannedEvents.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {bannedEvents.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-muted/50"
                      >
                        <div className="flex-1 min-w-0">
                          {renderEventPreview(entry.id)}
                        </div>
                        {entry.reason && (
                          <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                            {entry.reason}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {loadedBannedEvents && bannedEvents.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">
                    No banned events
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Batch Dialogs */}
      <BatchConfirmDialog
        open={showUnbanDialog}
        onOpenChange={setShowUnbanDialog}
        title="Unban Pubkeys"
        itemCount={selectedBannedPubkeys.size}
        itemType="pubkey"
        actionText="Unban"
        onConfirm={handleBatchUnban}
      />

      <BatchConfirmDialog
        open={showApproveDialog}
        onOpenChange={setShowApproveDialog}
        title="Approve Events"
        itemCount={selectedQueueEvents.size}
        itemType="event"
        actionText="Approve"
        onConfirm={handleBatchApprove}
      />

      <BatchConfirmDialog
        open={showRejectDialog}
        onOpenChange={setShowRejectDialog}
        title="Reject Events"
        itemCount={selectedQueueEvents.size}
        itemType="event"
        actionText="Reject"
        destructive
        onConfirm={handleBatchReject}
      />
    </div>
  );
}
