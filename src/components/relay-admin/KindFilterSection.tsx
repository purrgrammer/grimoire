/**
 * Kind Filter Section
 *
 * Manage allowed/disallowed event kinds on the relay.
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { KindSelector } from "@/components/KindSelector";
import { KindBadge } from "@/components/KindBadge";
import type { Nip86Client } from "@/lib/nip86-client";
import { BatchConfirmDialog } from "./ConfirmActionDialog";

interface KindFilterSectionProps {
  url: string;
  getClient: () => Nip86Client | null;
  supportedMethods: string[];
}

export function KindFilterSection({
  getClient,
  supportedMethods,
}: KindFilterSectionProps) {
  const canListKinds = supportedMethods.includes("listallowedkinds");
  const canAllowKind = supportedMethods.includes("allowkind");
  const canDisallowKind = supportedMethods.includes("disallowkind");

  const [kinds, setKinds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Selection state for batch operations
  const [selectedKinds, setSelectedKinds] = useState<Set<number>>(new Set());
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [_batchLoading, setBatchLoading] = useState(false);

  const fetchKinds = useCallback(async () => {
    const client = getClient();
    if (!client || !canListKinds) return;

    setLoading(true);
    try {
      const result = await client.listAllowedKinds();
      setKinds(result.sort((a, b) => a - b));
      setLoaded(true);
      setSelectedKinds(new Set());
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to fetch kinds",
      );
    } finally {
      setLoading(false);
    }
  }, [getClient, canListKinds]);

  const handleAddKind = async (kind: number) => {
    const client = getClient();
    if (!client || !canAllowKind) return;

    try {
      await client.allowKind(kind);
      toast.success(`Kind ${kind} allowed`);
      // Refresh list
      await fetchKinds();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to allow kind",
      );
    }
  };

  const handleRemoveKind = async (kind: number) => {
    const client = getClient();
    if (!client || !canDisallowKind) return;

    try {
      await client.disallowKind(kind);
      toast.success(`Kind ${kind} disallowed`);
      setKinds((prev) => prev.filter((k) => k !== kind));
      setSelectedKinds((prev) => {
        const next = new Set(prev);
        next.delete(kind);
        return next;
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to disallow kind",
      );
    }
  };

  const handleBatchRemove = async () => {
    const client = getClient();
    if (!client || !canDisallowKind || selectedKinds.size === 0) return;

    setBatchLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const kind of selectedKinds) {
      try {
        await client.disallowKind(kind);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setBatchLoading(false);

    if (successCount > 0) {
      toast.success(`Disallowed ${successCount} kind(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to disallow ${failCount} kind(s)`);
    }

    // Refresh list
    await fetchKinds();
  };

  const toggleKindSelection = (kind: number) => {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (selectedKinds.size === kinds.length) {
      setSelectedKinds(new Set());
    } else {
      setSelectedKinds(new Set(kinds));
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-2">
        {canListKinds && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchKinds}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="ml-2">{loaded ? "Refresh" : "Load Kinds"}</span>
          </Button>
        )}

        {canDisallowKind && selectedKinds.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowBatchDialog(true)}
          >
            <Trash2 className="size-4 mr-2" />
            Remove {selectedKinds.size} selected
          </Button>
        )}
      </div>

      {/* Add Kind */}
      {canAllowKind && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Add Kind</label>
          <KindSelector onSelect={handleAddKind} exclude={kinds} />
        </div>
      )}

      {/* Kinds List */}
      {loaded && kinds.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              Allowed Kinds ({kinds.length})
            </label>
            {canDisallowKind && kinds.length > 1 && (
              <Button variant="ghost" size="sm" onClick={toggleAllSelection}>
                {selectedKinds.size === kinds.length
                  ? "Deselect All"
                  : "Select All"}
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto">
            {kinds.map((kind) => (
              <div
                key={kind}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
              >
                {canDisallowKind && (
                  <Checkbox
                    checked={selectedKinds.has(kind)}
                    onCheckedChange={() => toggleKindSelection(kind)}
                  />
                )}
                <KindBadge kind={kind} />
                {canDisallowKind && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 ml-auto"
                    onClick={() => handleRemoveKind(kind)}
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
      {loaded && kinds.length === 0 && (
        <div className="text-sm text-muted-foreground py-4 text-center">
          No allowed kinds configured. This relay may accept all kinds.
        </div>
      )}

      {/* Batch Remove Dialog */}
      <BatchConfirmDialog
        open={showBatchDialog}
        onOpenChange={setShowBatchDialog}
        title="Remove Kinds"
        itemCount={selectedKinds.size}
        itemType="kind"
        actionText="Remove"
        destructive
        onConfirm={async () => {
          await handleBatchRemove();
        }}
      />
    </div>
  );
}
