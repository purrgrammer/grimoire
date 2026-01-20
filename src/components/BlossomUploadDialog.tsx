import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  HardDrive,
  Image as ImageIcon,
  Film,
  Music,
  FileIcon,
  FileText,
  Archive,
  CheckCircle,
  XCircle,
  Globe,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useEventStore } from "applesauce-react/hooks";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import { addressLoader } from "@/services/loaders";
import {
  USER_SERVER_LIST_KIND,
  getServersFromEvent,
  uploadBlobToServers,
  type UploadResult,
} from "@/services/blossom";
import type { Subscription } from "rxjs";

/**
 * Well-known public Blossom servers that can be used as fallbacks
 * when the user doesn't have their own server list configured
 */
const FALLBACK_SERVERS = ["https://blossom.band/"];

interface BlossomUploadDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Called when upload completes successfully */
  onSuccess: (results: UploadResult[]) => void;
  /** Called when upload is cancelled */
  onCancel?: () => void;
  /** Called when upload fails */
  onError?: (error: Error) => void;
  /** File types to accept (e.g., "image/*,video/*,audio/*") */
  accept?: string;
}

/**
 * BlossomUploadDialog - Modal dialog for uploading files to Blossom servers
 *
 * Features:
 * - File selection with drag & drop support
 * - Server selection from user's kind 10063 list
 * - Upload progress and results
 * - Preview for images/video/audio
 */
export function BlossomUploadDialog({
  open,
  onOpenChange,
  onSuccess,
  onCancel,
  onError,
  accept = "image/*,video/*,audio/*",
}: BlossomUploadDialogProps) {
  const eventStore = useEventStore();
  const activeAccount = use$(accountManager.active$);
  const pubkey = activeAccount?.pubkey;

  const [servers, setServers] = useState<string[]>([]);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(
    new Set(),
  );
  const [loadingServers, setLoadingServers] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);
  const [uploadErrors, setUploadErrors] = useState<
    { server: string; error: string }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setUploadResults([]);
      setUploadErrors([]);
      setUploading(false);
      setUsingFallback(false);
    }
  }, [open]);

  // Helper to set fallback servers
  const applyFallbackServers = useCallback(() => {
    setServers(FALLBACK_SERVERS);
    setSelectedServers(new Set([FALLBACK_SERVERS[0]])); // Select first by default
    setUsingFallback(true);
    setLoadingServers(false);
  }, []);

  // Fetch servers when dialog opens
  useEffect(() => {
    if (!open) {
      setLoadingServers(false);
      return;
    }

    // If no pubkey (not logged in), can't upload - auth required
    if (!pubkey) {
      setLoadingServers(false);
      return;
    }

    setLoadingServers(true);
    setUsingFallback(false);
    let subscription: Subscription | null = null;
    let foundUserServers = false;

    // Check existing event first
    const event = eventStore.getReplaceable(USER_SERVER_LIST_KIND, pubkey, "");
    if (event) {
      const s = getServersFromEvent(event);
      if (s.length > 0) {
        setServers(s);
        setSelectedServers(new Set(s)); // Select all by default
        setLoadingServers(false);
        foundUserServers = true;
      }
    }

    // Also fetch from network
    subscription = addressLoader({
      kind: USER_SERVER_LIST_KIND,
      pubkey,
      identifier: "",
    }).subscribe({
      next: () => {
        const e = eventStore.getReplaceable(USER_SERVER_LIST_KIND, pubkey, "");
        if (e) {
          const s = getServersFromEvent(e);
          if (s.length > 0) {
            setServers(s);
            setSelectedServers((prev) => (prev.size === 0 ? new Set(s) : prev));
            setUsingFallback(false);
            foundUserServers = true;
          }
        }
        setLoadingServers(false);
      },
      error: () => setLoadingServers(false),
    });

    // After timeout, use fallbacks if no user servers found
    const timeout = setTimeout(() => {
      setLoadingServers(false);
      if (!foundUserServers) {
        applyFallbackServers();
      }
    }, 3000);

    return () => {
      subscription?.unsubscribe();
      clearTimeout(timeout);
    };
  }, [open, pubkey, eventStore, applyFallbackServers]);

  // Create preview URL for selected file
  useEffect(() => {
    if (selectedFile && selectedFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPreviewUrl(null);
    }
  }, [selectedFile]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        setSelectedFile(files[0]);
        setUploadResults([]);
        setUploadErrors([]);
      }
    },
    [],
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      setUploadResults([]);
      setUploadErrors([]);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const toggleServer = useCallback((server: string) => {
    setSelectedServers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(server)) {
        newSet.delete(server);
      } else {
        newSet.add(server);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelectedServers(new Set(servers)),
    [servers],
  );
  const selectNone = useCallback(() => setSelectedServers(new Set()), []);

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("No file selected");
      return;
    }

    if (selectedServers.size === 0) {
      toast.error("Select at least one server");
      return;
    }

    setUploading(true);
    setUploadResults([]);
    setUploadErrors([]);

    try {
      const { results, errors } = await uploadBlobToServers(
        selectedFile,
        Array.from(selectedServers),
      );

      setUploadResults(results);
      setUploadErrors(errors);

      if (results.length > 0) {
        toast.success(
          `Uploaded to ${results.length}/${selectedServers.size} servers`,
        );
        // Call success callback with results
        onSuccess(results);
      } else {
        const error = new Error("Upload failed on all servers");
        toast.error(error.message);
        onError?.(error);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error("Upload failed");
      toast.error(err.message);
      onError?.(err);
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      onCancel?.();
      onOpenChange(false);
    }
  };

  // No account logged in
  if (!pubkey) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload to Blossom</DialogTitle>
            <DialogDescription>
              Sign in to upload files to your Blossom servers.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Upload className="size-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Account required to upload files
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="size-5" />
            Upload to Blossom
          </DialogTitle>
          <DialogDescription>
            Select a file and choose which servers to upload to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Selection / Drop Zone */}
          <div
            ref={dropZoneRef}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed rounded-lg p-4 text-center transition-colors hover:border-primary/50 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={handleFileChange}
              className="hidden"
              disabled={uploading}
            />
            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-32 max-w-full rounded object-contain"
                  />
                ) : (
                  getFileIcon(
                    selectedFile.type,
                    "size-12 text-muted-foreground",
                  )
                )}
                <p className="font-medium text-sm truncate max-w-xs text-center">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(selectedFile.size)} •{" "}
                  {selectedFile.type || "Unknown"}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <Upload className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Click or drop a file here
                </p>
                <p className="text-xs text-muted-foreground">
                  Images, videos, or audio
                </p>
              </div>
            )}
          </div>

          {/* Server Selection */}
          {loadingServers ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {usingFallback ? (
                    <Globe className="size-3.5 text-muted-foreground" />
                  ) : (
                    <HardDrive className="size-3.5 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {usingFallback ? "Public Servers" : "Your Servers"} (
                    {selectedServers.size}/{servers.length})
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={selectAll}
                    disabled={uploading}
                  >
                    All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={selectNone}
                    disabled={uploading}
                  >
                    None
                  </Button>
                </div>
              </div>
              {usingFallback && (
                <p className="text-xs text-muted-foreground mb-2">
                  No server list found. Using public servers.
                </p>
              )}
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {servers.map((server) => (
                  <label
                    key={server}
                    className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedServers.has(server)}
                      onCheckedChange={() => toggleServer(server)}
                      disabled={uploading}
                    />
                    {usingFallback ? (
                      <Globe className="size-3.5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <HardDrive className="size-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="font-mono text-xs truncate flex-1">
                      {server}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Upload Results */}
          {uploadResults.length > 0 && (
            <div className="border rounded-lg p-3 bg-green-50 dark:bg-green-950/30">
              <div className="flex items-center gap-2 text-green-600 mb-2">
                <CheckCircle className="size-4" />
                <span className="text-sm font-medium">
                  Uploaded ({uploadResults.length})
                </span>
              </div>
              <div className="space-y-1">
                {uploadResults.map((result) => (
                  <code
                    key={result.server}
                    className="text-xs block truncate text-green-700 dark:text-green-400"
                  >
                    {result.blob.url}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Upload Errors */}
          {uploadErrors.length > 0 && (
            <div className="border rounded-lg p-3 bg-red-50 dark:bg-red-950/30">
              <div className="flex items-center gap-2 text-red-600 mb-2">
                <XCircle className="size-4" />
                <span className="text-sm font-medium">
                  Failed ({uploadErrors.length})
                </span>
              </div>
              <div className="space-y-1">
                {uploadErrors.map((error) => (
                  <div
                    key={error.server}
                    className="text-xs text-red-700 dark:text-red-400"
                  >
                    {new URL(error.server).hostname}: {error.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleClose}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleUpload}
              disabled={
                uploading || !selectedFile || selectedServers.size === 0
              }
            >
              {uploading ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="size-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Get icon for file type
 */
function getFileIcon(mimeType?: string, className = "size-4") {
  if (!mimeType) return <FileIcon className={className} />;
  if (mimeType.startsWith("image/")) return <ImageIcon className={className} />;
  if (mimeType.startsWith("video/")) return <Film className={className} />;
  if (mimeType.startsWith("audio/")) return <Music className={className} />;
  if (mimeType.startsWith("text/")) return <FileText className={className} />;
  if (mimeType.includes("zip") || mimeType.includes("archive"))
    return <Archive className={className} />;
  return <FileIcon className={className} />;
}

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
