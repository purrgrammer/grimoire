import { ProfileContent } from "applesauce-core/helpers";
import { Dexie, Table } from "dexie";
import { RelayInformation } from "../types/nip11";

export interface Profile extends ProfileContent {
  pubkey: string;
  created_at: number;
}

export interface Nip05 {
  nip05: string;
  pubkey: string;
}

export interface Nip {
  id: string;
  content: string;
  fetchedAt: number;
}

export interface RelayInfo {
  url: string;
  info: RelayInformation;
  fetchedAt: number;
}

class GrimoireDb extends Dexie {
  profiles!: Table<Profile>;
  nip05!: Table<Nip05>;
  nips!: Table<Nip>;
  relayInfo!: Table<RelayInfo>;

  constructor(name: string) {
    super(name);
    this.version(4).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
      relayInfo: "&url",
    });
  }
}

const db = new GrimoireDb("grimoire-dev");

export default db;
