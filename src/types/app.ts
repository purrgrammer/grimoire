import type { MosaicNode } from "react-mosaic-component";
import type { GlobalRelayState } from "./relay-state";

export type AppId =
  | "nip"
  | "nips"
  | "kind"
  | "kinds"
  | "man"
  | "req"
  //| "event"
  | "open"
  | "profile"
  | "encode"
  | "decode"
  | "relay"
  | "debug"
  | "conn";

export interface WindowInstance {
  id: string;
  appId: AppId;
  title: string;
  props: any;
  commandString?: string; // Original command that created this window (e.g., "profile alice@domain.com")
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

export interface UserRelays {
  inbox: RelayInfo[];
  outbox: RelayInfo[];
  all: RelayInfo[];
}

export interface GrimoireState {
  __version: number; // Schema version for migrations
  windows: Record<string, WindowInstance>;
  workspaces: Record<string, Workspace>;
  activeWorkspaceId: string;
  activeAccount?: {
    pubkey: string;
    relays?: UserRelays;
  };
  locale?: {
    locale: string;
    language: string;
    region?: string;
    timezone: string;
    timeFormat: "12h" | "24h";
  };
  relayState?: GlobalRelayState;
}
