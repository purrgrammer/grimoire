import { ProfileContent } from "applesauce-core/helpers";
import { Dexie, Table } from "dexie";

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

class GrimoireDb extends Dexie {
  profiles!: Table<Profile>;
  nip05!: Table<Nip05>;
  nips!: Table<Nip>;

  constructor(name: string) {
    super(name);
    this.version(3).stores({
      profiles: "&pubkey",
      nip05: "&nip05",
      nips: "&id",
    });
  }
}

const db = new GrimoireDb("grimoire-dev");

export default db;
