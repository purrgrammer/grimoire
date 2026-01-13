import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  Server,
  Upload,
  List,
  Copy,
  CopyCheck,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  Trash2,
  RefreshCw,
  HardDrive,
  Clock,
  FileIcon,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGrimoire } from "@/core/state";
import { useEventStore } from "applesauce-react/hooks";
import { addressLoader } from "@/services/loaders";
import {
  USER_SERVER_LIST_KIND,
  getServersFromEvent,
  checkServer,
  listBlobs,
  uploadBlobToServers,
  deleteBlob,
  type BlobDescriptor,
  type ServerCheckResult,
  type UploadResult,
} from "@/services/blossom";
import { useCopy } from "@/hooks/useCopy";
import type { BlossomSubcommand } from "@/lib/blossom-parser";
import type { Subscription } from "rxjs";
import { formatDistanceToNow } from "date-fns";

interface BlossomViewerProps {
  subcommand: BlossomSubcommand;
  serverUrl?: string;
  pubkey?: string;
  sourceUrl?: string;
  targetServer?: string;
  sha256?: string;
}

/**
 * BlossomViewer - Main component for Blossom blob management
 */
export function BlossomViewer({
  subcommand,
  serverUrl,
  pubkey,
  sourceUrl,
  targetServer,
  sha256,
}: BlossomViewerProps) {
  switch (subcommand) {
    case "servers":
      return <ServersView />;
    case "check":
      return <CheckServerView serverUrl={serverUrl!} />;
    case "upload":
      return <UploadView />;
    case "list":
      return <ListBlobsView pubkey={pubkey} />;
    case "mirror":
      return <MirrorView sourceUrl={sourceUrl!} targetServer={targetServer!} />;
    case "delete":
      return <DeleteView sha256={sha256!} serverUrl={serverUrl!} />;
    default:
      return <ServersView />;
  }
}

/**
 * ServersView - Display user's configured Blossom servers
 */
function ServersView() {
  const { state } = useGrimoire();
  const eventStore = useEventStore();
  const pubkey = state.activeAccount?.pubkey;
  const [servers, setServers] = useState<string[]>([]);
  const [serverStatus, setServerStatus] = useState<
    Record<string, ServerCheckResult>
  >({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  // Fetch server list from kind 10063
  useEffect(() => {
    if (!pubkey) {
      setLoading(false);
      return;
    }

    let subscription: Subscription | null = null;

    const fetchServers = async () => {
      // First check if we already have the event
      const existingEvent = eventStore.getReplaceable(
        USER_SERVER_LIST_KIND,
        pubkey,
        "",
      );
      if (existingEvent) {
        setServers(getServersFromEvent(existingEvent));
        setLoading(false);
      }

      // Also fetch from network
      subscription = addressLoader({
        kind: USER_SERVER_LIST_KIND,
        pubkey,
        identifier: "",
      }).subscribe({
        next: () => {
          const event = eventStore.getReplaceable(
            USER_SERVER_LIST_KIND,
            pubkey,
            "",
          );
          if (event) {
            setServers(getServersFromEvent(event));
          }
          setLoading(false);
        },
        error: () => {
          setLoading(false);
        },
      });
    };

    fetchServers();

    // Timeout fallback
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    return () => {
      subscription?.unsubscribe();
      clearTimeout(timeout);
    };
  }, [pubkey, eventStore]);

  // Check all servers
  const checkAllServers = useCallback(async () => {
    if (servers.length === 0) return;

    setChecking(true);
    const results: Record<string, ServerCheckResult> = {};

    await Promise.all(
      servers.map(async (url) => {
        const result = await checkServer(url);
        results[url] = result;
      }),
    );

    setServerStatus(results);
    setChecking(false);
  }, [servers]);

  // Auto-check servers when loaded
  useEffect(() => {
    if (servers.length > 0 && Object.keys(serverStatus).length === 0) {
      checkAllServers();
    }
  }, [servers, serverStatus, checkAllServers]);

  if (!pubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <Server className="size-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Account Required</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Log in to view your Blossom server list. Your servers are stored in a
          kind 10063 event.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Your Blossom Servers ({servers.length})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={checkAllServers}
          disabled={checking || servers.length === 0}
        >
          {checking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          <span className="ml-1">Check All</span>
        </Button>
      </div>

      {/* Server List */}
      <div className="flex-1 overflow-y-auto">
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <HardDrive className="size-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No Servers Configured</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              You haven't published a Blossom server list (kind 10063) yet.
              Configure your servers in a Nostr client that supports Blossom.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {servers.map((url) => (
              <ServerRow key={url} url={url} status={serverStatus[url]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ServerRow - Single server display with status
 */
function ServerRow({
  url,
  status,
}: {
  url: string;
  status?: ServerCheckResult;
}) {
  const { copy, copied } = useCopy();

  return (
    <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/30">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {status ? (
          status.online ? (
            <CheckCircle className="size-4 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="size-4 text-red-500 flex-shrink-0" />
          )
        ) : (
          <div className="size-4 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm truncate">{url}</div>
          {status && (
            <div className="text-xs text-muted-foreground">
              {status.online ? (
                <span className="text-green-600">
                  Online ({status.responseTime}ms)
                </span>
              ) : (
                <span className="text-red-600">{status.error}</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={() => copy(url)}>
          {copied ? (
            <CopyCheck className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.open(url, "_blank")}
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * CheckServerView - Check a specific server's health
 */
function CheckServerView({ serverUrl }: { serverUrl: string }) {
  const [status, setStatus] = useState<ServerCheckResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      setLoading(true);
      const result = await checkServer(serverUrl);
      setStatus(result);
      setLoading(false);
    };
    check();
  }, [serverUrl]);

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
      {loading ? (
        <>
          <Loader2 className="size-12 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Checking {serverUrl}...</p>
        </>
      ) : status ? (
        <>
          {status.online ? (
            <CheckCircle className="size-16 text-green-500" />
          ) : (
            <XCircle className="size-16 text-red-500" />
          )}
          <h3 className="text-xl font-semibold">
            {status.online ? "Server Online" : "Server Offline"}
          </h3>
          <code className="text-sm bg-muted px-2 py-1 rounded">
            {serverUrl}
          </code>
          {status.online && status.responseTime && (
            <p className="text-muted-foreground">
              Response time: {status.responseTime}ms
            </p>
          )}
          {!status.online && status.error && (
            <p className="text-red-600 text-sm">{status.error}</p>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * UploadView - File upload interface
 */
function UploadView() {
  const { state } = useGrimoire();
  const eventStore = useEventStore();
  const pubkey = state.activeAccount?.pubkey;
  const [servers, setServers] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [errors, setErrors] = useState<{ server: string; error: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { copy, copied } = useCopy();

  // Fetch servers
  useEffect(() => {
    if (!pubkey) return;

    const event = eventStore.getReplaceable(USER_SERVER_LIST_KIND, pubkey, "");
    if (event) {
      setServers(getServersFromEvent(event));
    }

    const subscription = addressLoader({
      kind: USER_SERVER_LIST_KIND,
      pubkey,
      identifier: "",
    }).subscribe({
      next: () => {
        const e = eventStore.getReplaceable(USER_SERVER_LIST_KIND, pubkey, "");
        if (e) {
          setServers(getServersFromEvent(e));
        }
      },
    });

    return () => subscription.unsubscribe();
  }, [pubkey, eventStore]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    if (servers.length === 0) {
      toast.error("No Blossom servers configured");
      return;
    }

    setUploading(true);
    setResults([]);
    setErrors([]);

    try {
      const { results: uploadResults, errors: uploadErrors } =
        await uploadBlobToServers(file, servers);

      setResults(uploadResults);
      setErrors(uploadErrors);

      if (uploadResults.length > 0) {
        toast.success(
          `Uploaded to ${uploadResults.length}/${servers.length} servers`,
        );
      } else {
        toast.error("Upload failed on all servers");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  if (!pubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <Upload className="size-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Account Required</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Log in to upload files to your Blossom servers.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-2 flex items-center gap-2">
        <Upload className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Upload to Blossom</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Upload Area */}
        <div className="border-2 border-dashed rounded-lg p-8 text-center mb-4">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            disabled={uploading || servers.length === 0}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="size-8 text-muted-foreground" />
              <p className="text-muted-foreground">
                {servers.length === 0
                  ? "No servers configured"
                  : `Upload to ${servers.length} server${servers.length !== 1 ? "s" : ""}`}
              </p>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={servers.length === 0}
              >
                Select File
              </Button>
            </div>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-green-600">
              Uploaded Successfully ({results.length})
            </h4>
            {results.map((result) => (
              <div
                key={result.server}
                className="border rounded p-3 bg-green-50 dark:bg-green-950/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <code className="text-xs">{result.server}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copy(result.blob.url)}
                  >
                    {copied ? (
                      <CopyCheck className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    Copy URL
                  </Button>
                </div>
                <code className="text-xs text-muted-foreground break-all block">
                  {result.blob.url}
                </code>
              </div>
            ))}
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="space-y-2 mt-4">
            <h4 className="text-sm font-medium text-red-600">
              Failed ({errors.length})
            </h4>
            {errors.map((error) => (
              <div
                key={error.server}
                className="border rounded p-3 bg-red-50 dark:bg-red-950/30"
              >
                <code className="text-xs">{error.server}</code>
                <p className="text-xs text-red-600 mt-1">{error.error}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Get icon for file type
 */
function getFileIcon(mimeType?: string) {
  if (!mimeType) return <FileIcon className="size-4" />;
  if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" />;
  if (mimeType.startsWith("video/")) return <Film className="size-4" />;
  if (mimeType.startsWith("audio/")) return <Music className="size-4" />;
  if (mimeType.startsWith("text/")) return <FileText className="size-4" />;
  if (mimeType.includes("zip") || mimeType.includes("archive"))
    return <Archive className="size-4" />;
  return <FileIcon className="size-4" />;
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

/**
 * ListBlobsView - List blobs for a user
 */
function ListBlobsView({ pubkey }: { pubkey?: string }) {
  const { state } = useGrimoire();
  const eventStore = useEventStore();
  const accountPubkey = state.activeAccount?.pubkey;
  const targetPubkey = pubkey || accountPubkey;

  const [servers, setServers] = useState<string[]>([]);
  const [blobs, setBlobs] = useState<BlobDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const { copy, copied } = useCopy();

  // Fetch servers for the target pubkey
  useEffect(() => {
    if (!targetPubkey) {
      setLoading(false);
      return;
    }

    const event = eventStore.getReplaceable(
      USER_SERVER_LIST_KIND,
      targetPubkey,
      "",
    );
    if (event) {
      const s = getServersFromEvent(event);
      setServers(s);
      if (s.length > 0 && !selectedServer) {
        setSelectedServer(s[0]);
      }
    }

    const subscription = addressLoader({
      kind: USER_SERVER_LIST_KIND,
      pubkey: targetPubkey,
      identifier: "",
    }).subscribe({
      next: () => {
        const e = eventStore.getReplaceable(
          USER_SERVER_LIST_KIND,
          targetPubkey,
          "",
        );
        if (e) {
          const s = getServersFromEvent(e);
          setServers(s);
          if (s.length > 0 && !selectedServer) {
            setSelectedServer(s[0]);
          }
        }
        setLoading(false);
      },
      error: () => setLoading(false),
    });

    const timeout = setTimeout(() => setLoading(false), 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [targetPubkey, eventStore, selectedServer]);

  // Fetch blobs when server is selected
  useEffect(() => {
    if (!selectedServer || !targetPubkey) return;

    const fetchBlobs = async () => {
      setLoading(true);
      try {
        const result = await listBlobs(selectedServer, targetPubkey);
        setBlobs(result);
      } catch (_error) {
        toast.error("Failed to list blobs");
        setBlobs([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBlobs();
  }, [selectedServer, targetPubkey]);

  if (!targetPubkey) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <List className="size-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Account Required</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Log in to list your blobs, or specify a pubkey.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <List className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Blobs ({blobs.length})</span>
        </div>
        {servers.length > 1 && (
          <select
            value={selectedServer || ""}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="text-xs bg-muted rounded px-2 py-1"
          >
            {servers.map((s) => (
              <option key={s} value={s}>
                {new URL(s).hostname}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Blob List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <HardDrive className="size-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No Servers Found</h3>
            <p className="text-sm text-muted-foreground">
              This user has no Blossom server list configured.
            </p>
          </div>
        ) : blobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <FileIcon className="size-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">No Blobs Found</h3>
            <p className="text-sm text-muted-foreground">
              No files uploaded to this server yet.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {blobs.map((blob) => (
              <div
                key={blob.sha256}
                className="px-4 py-3 hover:bg-muted/30 flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {getFileIcon(blob.type)}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs truncate">
                      {blob.sha256.slice(0, 16)}...
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>{formatSize(blob.size)}</span>
                      {blob.type && <span>{blob.type}</span>}
                      {blob.uploaded && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatDistanceToNow(blob.uploaded * 1000, {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copy(blob.url)}
                  >
                    {copied ? (
                      <CopyCheck className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => window.open(blob.url, "_blank")}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * MirrorView - Mirror a blob to another server (placeholder)
 */
function MirrorView({
  sourceUrl,
  targetServer,
}: {
  sourceUrl: string;
  targetServer: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      <RefreshCw className="size-12 text-muted-foreground" />
      <h3 className="text-lg font-semibold">Mirror Blob</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Mirror from:
        <br />
        <code className="text-xs">{sourceUrl}</code>
        <br />
        <br />
        To server:
        <br />
        <code className="text-xs">{targetServer}</code>
      </p>
      <p className="text-xs text-muted-foreground">
        (Mirror functionality coming soon)
      </p>
    </div>
  );
}

/**
 * DeleteView - Delete a blob from a server (placeholder)
 */
function DeleteView({
  sha256,
  serverUrl,
}: {
  sha256: string;
  serverUrl: string;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteBlob(serverUrl, sha256);
      setDeleted(true);
      toast.success("Blob deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
      {deleted ? (
        <>
          <CheckCircle className="size-16 text-green-500" />
          <h3 className="text-xl font-semibold">Blob Deleted</h3>
        </>
      ) : (
        <>
          <Trash2 className="size-12 text-red-500" />
          <h3 className="text-lg font-semibold">Delete Blob</h3>
          <div className="text-sm text-muted-foreground max-w-md">
            <p className="mb-2">SHA256:</p>
            <code className="text-xs break-all">{sha256}</code>
            <p className="mt-4 mb-2">From server:</p>
            <code className="text-xs">{serverUrl}</code>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Trash2 className="size-4 mr-2" />
            )}
            Delete Blob
          </Button>
        </>
      )}
    </div>
  );
}

export default BlossomViewer;
