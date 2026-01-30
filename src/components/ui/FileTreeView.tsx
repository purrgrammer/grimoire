import { useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
  FileArchive,
  FileAudio,
  FileVideo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectoryTree, SelectedFile } from "@/lib/git-types";

interface FileTreeViewProps {
  tree: DirectoryTree;
  onFileSelect: (file: SelectedFile) => void;
  selectedPath?: string;
  className?: string;
}

interface TreeNodeProps {
  name: string;
  hash: string;
  path: string;
  isDirectory: boolean;
  content?: DirectoryTree | null;
  onFileSelect: (file: SelectedFile) => void;
  selectedPath?: string;
  depth: number;
}

/**
 * Get appropriate icon for a file based on extension
 */
function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Code files
  if (
    [
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "php",
      "swift",
      "kt",
      "scala",
      "zig",
      "lua",
      "sh",
      "bash",
      "zsh",
      "fish",
      "ps1",
      "pl",
      "r",
      "ex",
      "exs",
      "erl",
      "hs",
      "ml",
      "clj",
      "vim",
      "sol",
    ].includes(ext)
  ) {
    return FileCode;
  }

  // JSON/Config
  if (["json", "jsonc", "json5"].includes(ext)) {
    return FileJson;
  }

  // Text/Docs
  if (
    [
      "md",
      "mdx",
      "txt",
      "rst",
      "yaml",
      "yml",
      "toml",
      "ini",
      "cfg",
      "conf",
      "xml",
      "html",
      "htm",
      "css",
      "scss",
      "sass",
      "less",
      "csv",
      "log",
    ].includes(ext)
  ) {
    return FileText;
  }

  // Images
  if (
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext)
  ) {
    return Image;
  }

  // Archives
  if (["zip", "tar", "gz", "bz2", "7z", "rar", "xz"].includes(ext)) {
    return FileArchive;
  }

  // Audio
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) {
    return FileAudio;
  }

  // Video
  if (["mp4", "webm", "mkv", "avi", "mov", "wmv"].includes(ext)) {
    return FileVideo;
  }

  return File;
}

/**
 * Single tree node (file or directory)
 */
function TreeNode({
  name,
  hash,
  path,
  isDirectory,
  content,
  onFileSelect,
  selectedPath,
  depth,
}: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedPath === path;

  const handleClick = () => {
    if (isDirectory) {
      setIsOpen(!isOpen);
    } else {
      onFileSelect({ name, hash, path });
    }
  };

  const Icon = isDirectory ? (isOpen ? FolderOpen : Folder) : getFileIcon(name);

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          "flex items-center gap-1.5 w-full text-left py-0.5 px-1 hover:bg-muted/50 text-sm",
          isSelected && "bg-primary/20 text-primary",
          isDirectory && "font-medium",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {isDirectory ? (
          isOpen ? (
            <ChevronDown className="size-3 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground flex-shrink-0" />
          )
        ) : (
          <span className="size-3 flex-shrink-0" />
        )}
        <Icon
          className={cn(
            "size-4 flex-shrink-0",
            isDirectory ? "text-yellow-500" : "text-muted-foreground",
          )}
        />
        <span className="truncate">{name}</span>
      </button>

      {isDirectory && isOpen && content && (
        <TreeContents
          tree={content}
          basePath={path}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

interface TreeContentsProps {
  tree: DirectoryTree;
  basePath: string;
  onFileSelect: (file: SelectedFile) => void;
  selectedPath?: string;
  depth: number;
}

/**
 * Render contents of a directory
 */
function TreeContents({
  tree,
  basePath,
  onFileSelect,
  selectedPath,
  depth,
}: TreeContentsProps) {
  // Sort: directories first, then alphabetically
  const sortedEntries = useMemo(() => {
    const dirs = [...tree.directories].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const files = [...tree.files].sort((a, b) => a.name.localeCompare(b.name));
    return { dirs, files };
  }, [tree]);

  return (
    <div>
      {sortedEntries.dirs.map((dir) => {
        const dirPath = basePath ? `${basePath}/${dir.name}` : dir.name;
        return (
          <TreeNode
            key={dirPath}
            name={dir.name}
            hash={dir.hash}
            path={dirPath}
            isDirectory={true}
            content={dir.content}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
            depth={depth}
          />
        );
      })}
      {sortedEntries.files.map((file) => {
        const filePath = basePath ? `${basePath}/${file.name}` : file.name;
        return (
          <TreeNode
            key={filePath}
            name={file.name}
            hash={file.hash}
            path={filePath}
            isDirectory={false}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
            depth={depth}
          />
        );
      })}
    </div>
  );
}

/**
 * File tree view component for displaying git repository structure
 *
 * @example
 * <FileTreeView
 *   tree={directoryTree}
 *   onFileSelect={(file) => console.log('Selected:', file.path)}
 *   selectedPath={selectedFile?.path}
 * />
 */
export function FileTreeView({
  tree,
  onFileSelect,
  selectedPath,
  className,
}: FileTreeViewProps) {
  return (
    <div className={cn("font-mono text-xs", className)}>
      <TreeContents
        tree={tree}
        basePath=""
        onFileSelect={onFileSelect}
        selectedPath={selectedPath}
        depth={0}
      />
    </div>
  );
}
