import { useState } from "react";
import { FolderGit2, AlertCircle, FileQuestion, Binary } from "lucide-react";
import { useGitTree } from "@/hooks/useGitTree";
import { useGitBlob } from "@/hooks/useGitBlob";
import { FileTreeView } from "@/components/ui/FileTreeView";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { Skeleton } from "@/components/ui/skeleton/Skeleton";
import { cn } from "@/lib/utils";
import type { SelectedFile } from "@/lib/git-types";

interface RepositoryFilesSectionProps {
  cloneUrls: string[];
  className?: string;
}

/**
 * Get file extension from filename
 */
function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Repository files section with tree view and file content preview
 *
 * Displays a collapsible file tree on the left and file content on the right.
 * Files are fetched lazily when selected.
 */
export function RepositoryFilesSection({
  cloneUrls,
  className,
}: RepositoryFilesSectionProps) {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);

  // Fetch the repository tree
  const {
    tree,
    loading: treeLoading,
    error: treeError,
    serverUrl,
  } = useGitTree({
    cloneUrls,
    enabled: cloneUrls.length > 0,
  });

  // Fetch file content when a file is selected
  const {
    text: fileContent,
    loading: contentLoading,
    error: contentError,
    isBinary,
    content: rawContent,
  } = useGitBlob({
    serverUrl,
    hash: selectedFile?.hash ?? null,
    enabled: !!selectedFile && !!serverUrl,
  });

  // Get the language for syntax highlighting from the file extension
  const language = selectedFile
    ? getExtension(selectedFile.name) || null
    : null;

  const handleFileSelect = (file: SelectedFile) => {
    setSelectedFile(file);
  };

  // Don't render if no clone URLs
  if (cloneUrls.length === 0) {
    return null;
  }

  // Loading state
  if (treeLoading) {
    return (
      <section className={cn("flex flex-col gap-4", className)}>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <FolderGit2 className="size-5" />
          Files
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </section>
    );
  }

  // Error state - silently hide section
  if (treeError) {
    return null;
  }

  // No tree available
  if (!tree) {
    return null;
  }

  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <h2 className="text-xl font-semibold flex items-center gap-2">
        <FolderGit2 className="size-5" />
        Files
        {serverUrl && (
          <span className="text-xs text-muted-foreground font-normal ml-2">
            from {new URL(serverUrl).hostname}
          </span>
        )}
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* File Tree */}
        <div className="border border-border rounded p-2 max-h-96 overflow-auto bg-muted/20">
          <FileTreeView
            tree={tree}
            onFileSelect={handleFileSelect}
            selectedPath={selectedFile?.path}
          />
        </div>

        {/* File Content Preview */}
        <div className="border border-border rounded max-h-96 overflow-auto bg-muted/20">
          {selectedFile ? (
            contentLoading ? (
              <div className="relative">
                <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1.5 border-b border-border/50 flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {selectedFile.path}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ) : contentError ? (
              <div className="flex items-start gap-3 p-4 text-sm">
                <AlertCircle className="size-5 text-destructive flex-shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <p className="font-medium">Failed to load file</p>
                  <p className="text-muted-foreground text-xs">
                    {contentError.message}
                  </p>
                </div>
              </div>
            ) : isBinary ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                <Binary className="size-12 mb-4 opacity-50" />
                <p className="text-sm font-medium">Binary file</p>
                <p className="text-xs mt-1">
                  {rawContent && formatSize(rawContent.length)}
                </p>
              </div>
            ) : fileContent ? (
              <div className="relative">
                <div className="sticky top-0 bg-muted/80 backdrop-blur-sm px-3 py-1.5 border-b border-border/50 flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground truncate">
                    {selectedFile.path}
                  </span>
                  {rawContent && (
                    <span className="text-xs text-muted-foreground">
                      {formatSize(rawContent.length)}
                    </span>
                  )}
                </div>
                <SyntaxHighlight
                  code={fileContent}
                  language={language}
                  className="p-3"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                <FileQuestion className="size-12 mb-4 opacity-50" />
                <p className="text-sm">Empty file</p>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-48 p-8 text-muted-foreground">
              <FileQuestion className="size-12 mb-4 opacity-30" />
              <p className="text-sm">Select a file to view its contents</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
