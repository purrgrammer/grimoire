import { useState, useCallback, useMemo } from "react";
import { BlossomUploadDialog } from "@/components/BlossomUploadDialog";
import type { UploadResult } from "@/services/blossom";

export interface UseBlossomUploadOptions {
  /** Called when upload completes successfully */
  onSuccess?: (results: UploadResult[]) => void;
  /** Called when upload is cancelled */
  onCancel?: () => void;
  /** Called when upload fails */
  onError?: (error: Error) => void;
  /** File types to accept (e.g., "image/*,video/*,audio/*") */
  accept?: string;
}

export interface UseBlossomUploadReturn {
  /** Open the upload dialog */
  open: () => void;
  /** Close the upload dialog */
  close: () => void;
  /** Whether the dialog is currently open */
  isOpen: boolean;
  /** The dialog component to render */
  dialog: React.ReactNode;
}

/**
 * Hook for managing Blossom file uploads with a dialog
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { open, dialog } = useBlossomUpload({
 *     onSuccess: (results) => {
 *       const url = results[0].blob.url;
 *       insertIntoEditor(url);
 *     }
 *   });
 *
 *   return (
 *     <>
 *       <button onClick={open}>Upload</button>
 *       {dialog}
 *     </>
 *   );
 * }
 * ```
 */
export function useBlossomUpload(
  options: UseBlossomUploadOptions = {},
): UseBlossomUploadReturn {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleSuccess = useCallback(
    (results: UploadResult[]) => {
      options.onSuccess?.(results);
      close();
    },
    [options.onSuccess, close],
  );

  const handleCancel = useCallback(() => {
    options.onCancel?.();
    close();
  }, [options.onCancel, close]);

  const handleError = useCallback(
    (error: Error) => {
      options.onError?.(error);
      // Don't close on error - let user retry
    },
    [options.onError],
  );

  const dialog = useMemo(
    () => (
      <BlossomUploadDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
        onError={handleError}
        accept={options.accept}
      />
    ),
    [isOpen, handleSuccess, handleCancel, handleError, options.accept],
  );

  return { open, close, isOpen, dialog };
}
