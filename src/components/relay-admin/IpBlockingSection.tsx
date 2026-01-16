/**
 * IP Blocking Section
 *
 * Manage blocked IP addresses on the relay.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, Trash2, Plus, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { Nip86Client, IpEntry } from "@/lib/nip86-client";
import { BatchConfirmDialog, ConfirmActionDialog } from "./ConfirmActionDialog";

interface IpBlockingSectionProps {
  url: string;
  getClient: () => Nip86Client | null;
  supportedMethods: string[];
}

export function IpBlockingSection({
  getClient,
  supportedMethods,
}: IpBlockingSectionProps) {
  const canListIps = supportedMethods.includes("listblockedips");
  const canBlockIp = supportedMethods.includes("blockip");
  const canUnblockIp = supportedMethods.includes("unblockip");

  const [ips, setIps] = useState<IpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Add IP form
  const [newIp, setNewIp] = useState("");
  const [newReason, setNewReason] = useState("");
  const [addingIp, setAddingIp] = useState(false);

  // Selection state for batch operations
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
  const [showBatchDialog, setShowBatchDialog] = useState(false);

  // Single unblock confirmation
  const [ipToUnblock, setIpToUnblock] = useState<string | null>(null);

  const fetchIps = useCallback(async () => {
    const client = getClient();
    if (!client || !canListIps) return;

    setLoading(true);
    try {
      const result = await client.listBlockedIps();
      setIps(result);
      setLoaded(true);
      setSelectedIps(new Set());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fetch blocked IPs",
      );
    } finally {
      setLoading(false);
    }
  }, [getClient, canListIps]);

  const handleBlockIp = async () => {
    const client = getClient();
    if (!client || !canBlockIp || !newIp.trim()) return;

    setAddingIp(true);
    try {
      await client.blockIp(newIp.trim(), newReason.trim() || undefined);
      toast.success(`IP ${newIp} blocked`);
      setNewIp("");
      setNewReason("");
      // Refresh list
      await fetchIps();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to block IP",
      );
    } finally {
      setAddingIp(false);
    }
  };

  const handleUnblockIp = async (ip: string) => {
    const client = getClient();
    if (!client || !canUnblockIp) return;

    try {
      await client.unblockIp(ip);
      toast.success(`IP ${ip} unblocked`);
      setIps((prev) => prev.filter((entry) => entry.ip !== ip));
      setSelectedIps((prev) => {
        const next = new Set(prev);
        next.delete(ip);
        return next;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to unblock IP",
      );
    }
  };

  const handleBatchUnblock = async () => {
    const client = getClient();
    if (!client || !canUnblockIp || selectedIps.size === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const ip of selectedIps) {
      try {
        await client.unblockIp(ip);
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`Unblocked ${successCount} IP(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to unblock ${failCount} IP(s)`);
    }

    // Refresh list
    await fetchIps();
  };

  const toggleIpSelection = (ip: string) => {
    setSelectedIps((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) {
        next.delete(ip);
      } else {
        next.add(ip);
      }
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (selectedIps.size === ips.length) {
      setSelectedIps(new Set());
    } else {
      setSelectedIps(new Set(ips.map((entry) => entry.ip)));
    }
  };

  // Validate IP address format (basic validation)
  const isValidIp = (ip: string): boolean => {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 (simplified)
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        {canListIps && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchIps}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="ml-2">{loaded ? "Refresh" : "Load IPs"}</span>
          </Button>
        )}

        {canUnblockIp && selectedIps.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBatchDialog(true)}
          >
            <Trash2 className="size-4 mr-2" />
            Unblock {selectedIps.size} selected
          </Button>
        )}
      </div>

      {/* Add IP Form */}
      {canBlockIp && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Block IP Address</label>
          <div className="flex gap-2">
            <Input
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              placeholder="192.168.1.1 or 2001:db8::1"
              className="flex-1"
            />
            <Input
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="Reason (optional)"
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleBlockIp}
              disabled={addingIp || !newIp.trim() || !isValidIp(newIp.trim())}
            >
              {addingIp ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
            </Button>
          </div>
          {newIp && !isValidIp(newIp) && (
            <p className="text-xs text-destructive">
              Invalid IP address format
            </p>
          )}
        </div>
      )}

      {/* IPs List */}
      {loaded && ips.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              Blocked IPs ({ips.length})
            </label>
            {canUnblockIp && ips.length > 1 && (
              <Button variant="ghost" size="sm" onClick={toggleAllSelection}>
                {selectedIps.size === ips.length
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            )}
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {ips.map((entry) => (
              <div
                key={entry.ip}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
              >
                {canUnblockIp && (
                  <Checkbox
                    checked={selectedIps.has(entry.ip)}
                    onCheckedChange={() => toggleIpSelection(entry.ip)}
                  />
                )}
                <Globe className="size-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm">{entry.ip}</div>
                  {entry.reason && (
                    <div className="text-xs text-muted-foreground truncate">
                      {entry.reason}
                    </div>
                  )}
                </div>
                {canUnblockIp && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => setIpToUnblock(entry.ip)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {loaded && ips.length === 0 && (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No blocked IP addresses.
        </div>
      )}

      {/* Single Unblock Confirmation */}
      <ConfirmActionDialog
        open={!!ipToUnblock}
        onOpenChange={(open) => !open && setIpToUnblock(null)}
        title="Unblock IP Address"
        description={`Are you sure you want to unblock ${ipToUnblock}?`}
        confirmText="Unblock"
        onConfirm={async () => {
          if (ipToUnblock) {
            await handleUnblockIp(ipToUnblock);
            setIpToUnblock(null);
          }
        }}
      />

      {/* Batch Unblock Dialog */}
      <BatchConfirmDialog
        open={showBatchDialog}
        onOpenChange={setShowBatchDialog}
        title="Unblock IP Addresses"
        itemCount={selectedIps.size}
        itemType="IP address"
        actionText="Unblock"
        onConfirm={handleBatchUnblock}
      />
    </div>
  );
}
