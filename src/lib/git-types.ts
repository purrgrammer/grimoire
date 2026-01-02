/**
 * Types for git repository tree visualization
 * Based on @fiatjaf/git-natural-api library
 */

/**
 * Directory tree structure returned by git-natural-api
 */
export interface DirectoryTree {
  directories: Array<{
    name: string;
    hash: string;
    content: DirectoryTree | null;
  }>;
  files: Array<{
    name: string;
    hash: string;
    content: Uint8Array | null;
  }>;
}

/**
 * Git server info/refs response
 */
export interface GitInfoRefs {
  service: string | null;
  refs: Record<string, string>;
  capabilities: string[];
  symrefs: Record<string, string>;
}

/**
 * Flattened file entry for tree display
 */
export interface FileEntry {
  name: string;
  hash: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
}

/**
 * Selected file in the tree
 */
export interface SelectedFile {
  name: string;
  hash: string;
  path: string;
}
