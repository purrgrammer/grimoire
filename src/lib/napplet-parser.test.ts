import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { NAPPLET_KINDS as KEHTO_NAPPLET_KINDS } from "@kehto/nip/5d";
import {
  NAPPLET_KINDS,
  parseAppCommand,
  buildManifestFilter,
  getPointerRelays,
  getMissingRequiredNaps,
} from "./napplet-parser";
import type { AddressPointer, EventPointer } from "./open-parser";

const PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT_ID =
  "1111111111111111111111111111111111111111111111111111111111111111";

describe("NAPPLET_KINDS", () => {
  it("matches Kehto's manifest kinds", () => {
    expect([...NAPPLET_KINDS].sort()).toEqual([...KEHTO_NAPPLET_KINDS].sort());
  });
});

describe("parseAppCommand", () => {
  it("requires an identifier", () => {
    expect(() => parseAppCommand([])).toThrow();
  });

  it.each([5129, 15129, 35129])("accepts an naddr for kind %i", (kind) => {
    const naddr = nip19.naddrEncode({
      kind,
      pubkey: PUBKEY,
      identifier: "calculator",
    });
    const { pointer } = parseAppCommand([naddr]) as {
      pointer: AddressPointer;
    };
    expect(pointer.kind).toBe(kind);
    expect(pointer.pubkey).toBe(PUBKEY);
    expect(pointer.identifier).toBe("calculator");
  });

  it("rejects an naddr for a non-napplet kind", () => {
    const naddr = nip19.naddrEncode({
      kind: 35128,
      pubkey: PUBKEY,
      identifier: "blog",
    });
    expect(() => parseAppCommand([naddr])).toThrow(/not a napplet manifest/i);
  });

  it("accepts kind:pubkey:dtag", () => {
    const { pointer } = parseAppCommand([`35129:${PUBKEY}:calc`]) as {
      pointer: AddressPointer;
    };
    expect(pointer).toMatchObject({
      kind: 35129,
      pubkey: PUBKEY,
      identifier: "calc",
    });
  });

  it("rejects kind:pubkey:dtag for a non-napplet kind", () => {
    expect(() => parseAppCommand([`1:${PUBKEY}:x`])).toThrow(
      /not a napplet manifest/i,
    );
  });

  it("accepts a bare hex event id", () => {
    const { pointer } = parseAppCommand([EVENT_ID]) as {
      pointer: EventPointer;
    };
    expect(pointer.id).toBe(EVENT_ID);
  });

  it("accepts note1", () => {
    const { pointer } = parseAppCommand([nip19.noteEncode(EVENT_ID)]) as {
      pointer: EventPointer;
    };
    expect(pointer.id).toBe(EVENT_ID);
  });

  it("accepts nevent and preserves relay hints", () => {
    const nevent = nip19.neventEncode({
      id: EVENT_ID,
      relays: ["wss://relay.example.com"],
    });
    const { pointer } = parseAppCommand([nevent]) as { pointer: EventPointer };
    expect(pointer.id).toBe(EVENT_ID);
    expect(pointer.relays).toEqual(["wss://relay.example.com/"]);
  });

  it("rejects malformed bech32", () => {
    expect(() => parseAppCommand(["naddr1notreallybech32"])).toThrow();
  });
});

describe("buildManifestFilter", () => {
  it("filters an address pointer by kind, author and d tag", () => {
    expect(
      buildManifestFilter({
        kind: 35129,
        pubkey: PUBKEY,
        identifier: "calc",
      }),
    ).toEqual({
      kinds: [35129],
      authors: [PUBKEY],
      "#d": ["calc"],
      limit: 1,
    });
  });

  it("omits #d for a root manifest, which carries no d tag", () => {
    expect(
      buildManifestFilter({ kind: 15129, pubkey: PUBKEY, identifier: "" }),
    ).toEqual({ kinds: [15129], authors: [PUBKEY], limit: 1 });
  });

  it("filters an event pointer by id", () => {
    expect(buildManifestFilter({ id: EVENT_ID })).toEqual({ ids: [EVENT_ID] });
  });
});

describe("getPointerRelays", () => {
  it("returns hints when present and an empty list otherwise", () => {
    expect(getPointerRelays({ id: EVENT_ID, relays: ["wss://a"] })).toEqual([
      "wss://a",
    ]);
    expect(getPointerRelays({ id: EVENT_ID })).toEqual([]);
  });
});

describe("getMissingRequiredNaps", () => {
  it("returns nothing when the manifest requires nothing", () => {
    expect(getMissingRequiredNaps([], [])).toEqual([]);
    expect(getMissingRequiredNaps([], ["theme"])).toEqual([]);
  });

  it("returns everything when the shell offers nothing", () => {
    expect(getMissingRequiredNaps(["theme", "relay"], [])).toEqual([
      "theme",
      "relay",
    ]);
  });

  it("returns only the complement", () => {
    expect(
      getMissingRequiredNaps(["theme", "config", "relay"], ["theme", "config"]),
    ).toEqual(["relay"]);
  });

  it("deduplicates repeated requires", () => {
    expect(getMissingRequiredNaps(["relay", "relay"], ["theme"])).toEqual([
      "relay",
    ]);
  });
});
