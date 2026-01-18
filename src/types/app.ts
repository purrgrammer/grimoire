import type { MosaicNode } from "react-mosaic-component";
import type { GlobalRelayState } from "./relay-state";

export type AppId =
  | "nip"
  | "nips"
  | "kind"
  | "kinds"
  | "man"
  | "req"
  | "count"
  //| "event"
  | "open"
  | "profile"
  | "encode"
  | "decode"
  | "relay"
  | "debug"
  | "conn"
  | "chat"
  | "spells"
  | "spellbooks"
  | "blossom"
  | "wallet"
  | "zap"
  | "win";

export interface WindowInstance {
  id: string;
  appId: AppId;
  title?: string; // Legacy field - rarely used now that DynamicWindowTitle handles all titles
  customTitle?: string; // User-provided custom title via --title flag (overrides dynamic title)
  props: any;
  commandString?: string; // Original command that created this window (e.g., "profile alice@domain.com")
  spellId?: string; // ID of the spell that created this window (if any)
}

/**
 * Configuration for how new windows are inserted into the workspace layout tree
 */
export interface LayoutConfig {
  /**
   * How to determine split direction for new windows
   * - 'smart': Auto-balance horizontal/vertical splits (recommended)
   * - 'row': Always horizontal splits (side-by-side)
   * - 'column': Always vertical splits (stacked)
   */
  insertionMode: "smart" | "row" | "column";

  /**
   * Split percentage for new windows (10-90)
   * Example: 70 means existing content gets 70%, new window gets 30%
   */
  splitPercentage: number;

  /**
   * Where to place the new window
   * - 'first': Left (for row) or Top (for column)
   * - 'second': Right (for row) or Bottom (for column)
   */
  insertionPosition: "first" | "second";

  /**
   * Optional: Auto-maintain a preset layout structure
   * When set, system tries to preserve this preset when adding windows
   */
  autoPreset?: string;
}

export interface Workspace {
  id: string;
  number: number; // Numeric identifier for shortcuts (e.g., Cmd+1, Cmd+2)
  label?: string; // Optional user-editable label
  layout: MosaicNode<string> | null;
  windowIds: string[];
}

export interface RelayInfo {
  url: string;
  read: boolean;
  write: boolean;
}

/**
 * Nostr Wallet Connect (NIP-47) wallet connection
 */
export interface NWCConnection {
  /** The wallet service's public key */
  service: string;
  /** Relay URL(s) for communication */
  relays: string[];
  /** Shared secret for encryption */
  secret: string;
  /** Optional lightning address (lud16) */
  lud16?: string;
  /** Optional cached balance in millisats */
  balance?: number;
  /** Optional wallet info */
  info?: {
    alias?: string;
    methods?: string[];
    notifications?: string[];
  };
  /** Last connection time */
  lastConnected?: number;
}

export interface GrimoireState {
  __version: number; // Schema version for migrations
  windows: Record<string, WindowInstance>;
  workspaces: Record<string, Workspace>;
  activeWorkspaceId: string;
  layoutConfig: LayoutConfig; // Global configuration for window insertion behavior
  activeAccount?: {
    pubkey: string;
    relays?: RelayInfo[];
    blossomServers?: string[];
  };
  compactModeKinds?: number[];
  locale?: {
    locale: string;
    language: string;
    region?: string;
    timezone: string;
    timeFormat: "12h" | "24h";
  };
  relayState?: GlobalRelayState;
  activeSpellbook?: {
    id: string; // event id or local uuid
    slug: string; // d-tag
    title: string;
    description?: string;
    pubkey?: string; // owner's pubkey (undefined = local-only, never published)
    // Enhanced fields for better UX:
    source: "local" | "network"; // Where the spellbook was loaded from
    localId?: string; // Local DB ID if saved to library
    isPublished?: boolean; // Whether it has been published to Nostr
  };
  nwcConnection?: NWCConnection;
}
