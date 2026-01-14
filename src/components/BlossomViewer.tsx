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
  ArrowLeft,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    case "server":
      return <ServerView serverUrl={serverUrl!} />;
    case "upload":
      return <UploadView />;
    case "list":
      return <ListBlobsView pubkey={pubkey} serverUrl={serverUrl} />;
    case "blob":
      return <BlobDetailView sha256={sha256!} serverUrl={serverUrl} />;
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
 * ServerView - View info about a specific Blossom server
 */
function ServerView({ serverUrl }: { serverUrl: string }) {
  const { copy, copied } = useCopy();
  const [status, setStatus] = useState<ServerCheckResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Check server status on mount
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      setLoading(true);
      const result = await checkServer(serverUrl);
      if (!cancelled) {
        setStatus(result);
        setLoading(false);
      }
    };

    check();

    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const hostname = (() => {
    try {
      return new URL(serverUrl).hostname;
    } catch {
      return serverUrl;
    }
  })();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-2 flex items-center gap-2">
        <HardDrive className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Blossom Server</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Server Info */}
        <div className="border rounded-lg divide-y">
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground uppercase mb-1">
              URL
            </div>
            <div className="flex items-center gap-2">
              <code className="text-sm break-all flex-1">{serverUrl}</code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copy(serverUrl)}
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
                onClick={() => window.open(serverUrl, "_blank")}
              >
                <ExternalLink className="size-4" />
              </Button>
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground uppercase mb-1">
              Hostname
            </div>
            <div className="text-sm">{hostname}</div>
          </div>

          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground uppercase mb-1">
              Status
            </div>
            {loading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Checking...
                </span>
              </div>
            ) : status ? (
              <div className="flex items-center gap-2">
                {status.online ? (
                  <>
                    <CheckCircle className="size-4 text-green-500" />
                    <span className="text-sm text-green-600">
                      Online ({status.responseTime}ms)
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 text-red-500" />
                    <span className="text-sm text-red-600">{status.error}</span>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => window.open(serverUrl, "_blank")}
          >
            <ExternalLink className="size-4 mr-2" />
            Open in Browser
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * UploadView - File upload interface with server selection
 */
function UploadView() {
  const { state } = useGrimoire();
  const eventStore = useEventStore();
  const pubkey = state.activeAccount?.pubkey;
  const [servers, setServers] = useState<string[]>([]);
  const [selectedServers, setSelectedServers] = useState<Set<string>>(
    new Set(),
  );
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [errors, setErrors] = useState<{ server: string; error: string }[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { copy, copied } = useCopy();

  // Fetch servers
  useEffect(() => {
    if (!pubkey) return;

    const event = eventStore.getReplaceable(USER_SERVER_LIST_KIND, pubkey, "");
    if (event) {
      const s = getServersFromEvent(event);
      setServers(s);
      // Select all by default
      setSelectedServers(new Set(s));
    }

    const subscription = addressLoader({
      kind: USER_SERVER_LIST_KIND,
      pubkey,
      identifier: "",
    }).subscribe({
      next: () => {
        const e = eventStore.getReplaceable(USER_SERVER_LIST_KIND, pubkey, "");
        if (e) {
          const s = getServersFromEvent(e);
          setServers(s);
          // Select all by default if not already set
          setSelectedServers((prev) => (prev.size === 0 ? new Set(s) : prev));
        }
      },
    });

    return () => subscription.unsubscribe();
  }, [pubkey, eventStore]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      setResults([]);
      setErrors([]);
    }
  };

  const toggleServer = (server: string) => {
    setSelectedServers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(server)) {
        newSet.delete(server);
      } else {
        newSet.add(server);
      }
      return newSet;
    });
  };

  const selectAll = () => setSelectedServers(new Set(servers));
  const selectNone = () => setSelectedServers(new Set());

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
    setResults([]);
    setErrors([]);

    try {
      const { results: uploadResults, errors: uploadErrors } =
        await uploadBlobToServers(selectedFile, Array.from(selectedServers));

      setResults(uploadResults);
      setErrors(uploadErrors);

      if (uploadResults.length > 0) {
        toast.success(
          `Uploaded to ${uploadResults.length}/${selectedServers.size} servers`,
        );
      } else {
        toast.error("Upload failed on all servers");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
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

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* File Selection */}
        <div className="border-2 border-dashed rounded-lg p-6 text-center">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
          {selectedFile ? (
            <div className="flex flex-col items-center gap-2">
              {getFileIcon(selectedFile.type, "size-8")}
              <p className="font-medium truncate max-w-full">
                {selectedFile.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatSize(selectedFile.size)} -{" "}
                {selectedFile.type || "Unknown type"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                Change File
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="size-8 text-muted-foreground" />
              <p className="text-muted-foreground">Select a file to upload</p>
              <Button onClick={() => fileInputRef.current?.click()}>
                Select File
              </Button>
            </div>
          )}
        </div>

        {/* Server Selection */}
        {servers.length > 0 && (
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">
                Upload to ({selectedServers.size}/{servers.length} selected)
              </h4>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  All
                </Button>
                <Button variant="ghost" size="sm" onClick={selectNone}>
                  None
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {servers.map((server) => (
                <label
                  key={server}
                  className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedServers.has(server)}
                    onCheckedChange={() => toggleServer(server)}
                    disabled={uploading}
                  />
                  <HardDrive className="size-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono text-sm truncate flex-1">
                    {server}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {servers.length === 0 && (
          <div className="border rounded-lg p-4 text-center text-muted-foreground">
            <HardDrive className="size-8 mx-auto mb-2" />
            <p className="text-sm">No Blossom servers configured</p>
          </div>
        )}

        {/* Upload Button */}
        <Button
          className="w-full"
          onClick={handleUpload}
          disabled={uploading || !selectedFile || selectedServers.size === 0}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="size-4 mr-2" />
              Upload to {selectedServers.size} Server
              {selectedServers.size !== 1 ? "s" : ""}
            </>
          )}
        </Button>

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
          <div className="space-y-2">
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

/**
 * ListBlobsView - List blobs for a user
 */
function ListBlobsView({
  pubkey,
  serverUrl,
}: {
  pubkey?: string;
  serverUrl?: string;
}) {
  const { state } = useGrimoire();
  const eventStore = useEventStore();
  const accountPubkey = state.activeAccount?.pubkey;
  const targetPubkey = pubkey || accountPubkey;

  const [servers, setServers] = useState<string[]>([]);
  const [blobs, setBlobs] = useState<BlobDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedServer, setSelectedServer] = useState<string | null>(
    serverUrl || null,
  );
  const [selectedBlob, setSelectedBlob] = useState<BlobDescriptor | null>(null);

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
      // Only set default server if no serverUrl was provided and no server is selected
      if (s.length > 0 && !selectedServer && !serverUrl) {
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
          // Only set default server if no serverUrl was provided and no server is selected
          if (s.length > 0 && !selectedServer && !serverUrl) {
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

  // Show blob detail view if a blob is selected
  if (selectedBlob) {
    return (
      <BlobDetailView
        blob={selectedBlob}
        serverUrl={selectedServer!}
        onBack={() => setSelectedBlob(null)}
      />
    );
  }

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
              <BlobRow
                key={blob.sha256}
                blob={blob}
                onClick={() => setSelectedBlob(blob)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * BlobRow - Single blob in list view
 */
function BlobRow({
  blob,
  onClick,
}: {
  blob: BlobDescriptor;
  onClick: () => void;
}) {
  const { copy, copied } = useCopy();

  return (
    <div
      className="px-4 py-3 hover:bg-muted/30 flex items-center justify-between cursor-pointer"
      onClick={onClick}
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
          onClick={(e) => {
            e.stopPropagation();
            copy(blob.url);
          }}
        >
          {copied ? (
            <CopyCheck className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
        <Button variant="ghost" size="icon">
          <Eye className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * BlobDetailView - Detailed view of a single blob
 */
function BlobDetailView({
  sha256,
  serverUrl,
  blob: initialBlob,
  onBack,
}: {
  sha256?: string;
  serverUrl?: string;
  blob?: BlobDescriptor;
  onBack?: () => void;
}) {
  const { copy, copied } = useCopy();
  const blob = initialBlob;

  // If we have a blob descriptor, use that data
  const blobUrl =
    blob?.url || (serverUrl && sha256 ? `${serverUrl}/${sha256}` : null);
  const blobSha256 = blob?.sha256 || sha256;
  const mimeType = blob?.type;

  const isImage = mimeType?.startsWith("image/");
  const isVideo = mimeType?.startsWith("video/");
  const isAudio = mimeType?.startsWith("audio/");

  if (!blobSha256) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <FileIcon className="size-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">No Blob Selected</h3>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-2 flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <FileIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Blob Details</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Preview */}
        {blobUrl && (
          <div className="border rounded-lg overflow-hidden bg-muted/30">
            {isImage && (
              <img
                src={blobUrl}
                alt="Blob preview"
                className="max-w-full max-h-64 mx-auto object-contain"
              />
            )}
            {isVideo && (
              <video
                src={blobUrl}
                controls
                className="max-w-full max-h-64 mx-auto"
              />
            )}
            {isAudio && (
              <div className="p-4">
                <audio src={blobUrl} controls className="w-full" />
              </div>
            )}
            {!isImage && !isVideo && !isAudio && (
              <div className="p-8 text-center">
                {getFileIcon(
                  mimeType,
                  "size-16 mx-auto mb-2 text-muted-foreground",
                )}
                <p className="text-sm text-muted-foreground">
                  Preview not available
                </p>
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="border rounded-lg divide-y">
          <div className="px-4 py-3">
            <div className="text-xs text-muted-foreground uppercase mb-1">
              SHA256
            </div>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all flex-1">{blobSha256}</code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copy(blobSha256)}
              >
                {copied ? (
                  <CopyCheck className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {blobUrl && (
            <div className="px-4 py-3">
              <div className="text-xs text-muted-foreground uppercase mb-1">
                URL
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all flex-1">{blobUrl}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copy(blobUrl)}
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
                  onClick={() => window.open(blobUrl, "_blank")}
                >
                  <ExternalLink className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {serverUrl && (
            <div className="px-4 py-3">
              <div className="text-xs text-muted-foreground uppercase mb-1">
                Server
              </div>
              <div className="flex items-center gap-2">
                <HardDrive className="size-4 text-muted-foreground" />
                <code className="text-xs">{serverUrl}</code>
              </div>
            </div>
          )}

          {blob && (
            <>
              <div className="px-4 py-3">
                <div className="text-xs text-muted-foreground uppercase mb-1">
                  Size
                </div>
                <div className="text-sm">{formatSize(blob.size)}</div>
              </div>

              {blob.type && (
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground uppercase mb-1">
                    Type
                  </div>
                  <div className="text-sm">{blob.type}</div>
                </div>
              )}

              {blob.uploaded && (
                <div className="px-4 py-3">
                  <div className="text-xs text-muted-foreground uppercase mb-1">
                    Uploaded
                  </div>
                  <div className="text-sm">
                    {new Date(blob.uploaded * 1000).toLocaleString()}
                    <span className="text-muted-foreground ml-2">
                      (
                      {formatDistanceToNow(blob.uploaded * 1000, {
                        addSuffix: true,
                      })}
                      )
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * MirrorView - Mirror a blob to another server
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
 * DeleteView - Delete a blob from a server
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
