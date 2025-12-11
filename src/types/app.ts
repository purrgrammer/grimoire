import { MosaicNode } from "react-mosaic-component";

export type AppId =
  | "nip"
  | "kind"
  | "man"
  | "feed"
  | "win"
  | "req"
  | "open"
  | "profile"
  | "encode"
  | "decode"
  | "relay"
  | "debug";

export interface WindowInstance {
  id: string;
  appId: AppId;
  title: string;
  props: any;
}

export interface Workspace {
  id: string;
  label: string;
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
}
