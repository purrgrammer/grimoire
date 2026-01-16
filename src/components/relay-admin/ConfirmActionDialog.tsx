/**
 * Confirm Action Dialog
 *
 * Reusable confirmation dialog for destructive actions.
 */

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  showReasonInput?: boolean;
  onConfirm: (reason?: string) => Promise<void>;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  destructive = false,
  showReasonInput = false,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(reason || undefined);
      onOpenChange(false);
      setReason("");
    } catch {
      // Error is handled by caller via toast
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    setReason("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && (
              <AlertTriangle className="size-5 text-destructive" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {showReasonInput && (
          <div className="py-4">
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Batch Confirm Dialog
 *
 * For confirming actions on multiple items.
 */
interface BatchConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  itemCount: number;
  itemType: string;
  actionText: string;
  destructive?: boolean;
  showReasonInput?: boolean;
  onConfirm: (reason?: string) => Promise<void>;
}

export function BatchConfirmDialog({
  open,
  onOpenChange,
  title,
  itemCount,
  itemType,
  actionText,
  destructive = false,
  showReasonInput = false,
  onConfirm,
}: BatchConfirmDialogProps) {
  const description = `You are about to ${actionText.toLowerCase()} ${itemCount} ${itemType}${itemCount === 1 ? "" : "s"}. This action cannot be undone.`;

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmText={`${actionText} ${itemCount} ${itemType}${itemCount === 1 ? "" : "s"}`}
      destructive={destructive}
      showReasonInput={showReasonInput}
      onConfirm={onConfirm}
    />
  );
}
