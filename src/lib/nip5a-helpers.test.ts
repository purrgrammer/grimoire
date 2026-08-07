import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import {
  getNsiteAggregateHash,
  getNsiteParent,
  getNsiteOrigin,
  getNsiteGatewayUrl,
  getNsitePaths,
} from "./nip5a-helpers";
import type { NostrEvent } from "@/types/nostr";

const PUBKEY =
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const EVENT_ID =
  "0000000000000000000000000000000000000000000000000000000000000001";
const AGGREGATE =
  "aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff00112233";

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: EVENT_ID,
    pubkey: PUBKEY,
    created_at: 1700000000,
    kind: 15128,
    tags: [],
    content: "",
    sig: "",
    ...overrides,
  } as NostrEvent;
}

describe("getNsiteAggregateHash", () => {
  it("reads the x tag", () => {
    const event = makeEvent({ tags: [["x", AGGREGATE, "aggregate"]] });
    expect(getNsiteAggregateHash(event)).toBe(AGGREGATE);
  });

  it("returns undefined when absent", () => {
    expect(getNsiteAggregateHash(makeEvent())).toBeUndefined();
  });

  it("ignores an x tag with no value", () => {
    const event = makeEvent({ tags: [["x"], ["x", AGGREGATE]] });
    expect(getNsiteAggregateHash(event)).toBe(AGGREGATE);
  });
});

describe("lineage tags", () => {
  it("parses the a tag as the immediate parent", () => {
    const event = makeEvent({
      tags: [["a", `35128:${PUBKEY}:blog`, "wss://relay.example"]],
    });
    expect(getNsiteParent(event)).toEqual({
      coordinate: `35128:${PUBKEY}:blog`,
      kind: 35128,
      pubkey: PUBKEY,
      identifier: "blog",
      relay: "wss://relay.example",
    });
  });

  it("parses the A tag as the lineage origin", () => {
    const event = makeEvent({ tags: [["A", `15128:${PUBKEY}:`]] });
    expect(getNsiteOrigin(event)).toEqual({
      coordinate: `15128:${PUBKEY}:`,
      kind: 15128,
      pubkey: PUBKEY,
      identifier: "",
      relay: undefined,
    });
  });

  it("keeps colons inside a d-tag identifier", () => {
    const event = makeEvent({ tags: [["a", `35128:${PUBKEY}:a:b`]] });
    expect(getNsiteParent(event)?.identifier).toBe("a:b");
  });

  it("returns undefined for a malformed coordinate", () => {
    expect(
      getNsiteParent(makeEvent({ tags: [["a", "nope"]] })),
    ).toBeUndefined();
    expect(
      getNsiteParent(makeEvent({ tags: [["a", `x:${PUBKEY}:d`]] })),
    ).toBeUndefined();
  });

  it("returns undefined when the tags are absent", () => {
    const event = makeEvent();
    expect(getNsiteParent(event)).toBeUndefined();
    expect(getNsiteOrigin(event)).toBeUndefined();
  });
});

describe("getNsiteGatewayUrl", () => {
  it("uses an npub subdomain for root sites", () => {
    const url = getNsiteGatewayUrl(makeEvent({ kind: 15128 }));
    expect(url).toBe(`https://${nip19.npubEncode(PUBKEY)}.nsite.lol`);
  });

  it("uses <pubkeyB36><dTag> for named sites", () => {
    const url = getNsiteGatewayUrl(
      makeEvent({ kind: 35128, tags: [["d", "blog"]] }),
    );
    const [, subdomain] = /^https:\/\/([^.]+)\./.exec(url)!;
    expect(subdomain).toHaveLength(50 + "blog".length);
    expect(subdomain.endsWith("blog")).toBe(true);
    expect(subdomain.slice(0, 50)).toMatch(/^[0-9a-z]{50}$/);
  });

  it("falls back to the root form for a named site with no d tag", () => {
    const url = getNsiteGatewayUrl(makeEvent({ kind: 35128 }));
    expect(url).toBe(`https://${nip19.npubEncode(PUBKEY)}.nsite.lol`);
  });

  it("uses v<snapshotIdB36> for snapshots", () => {
    const url = getNsiteGatewayUrl(makeEvent({ kind: 5128 }));
    const [, subdomain] = /^https:\/\/([^.]+)\./.exec(url)!;
    expect(subdomain[0]).toBe("v");
    expect(subdomain.slice(1)).toHaveLength(50);
    expect(subdomain.slice(1)).toMatch(/^[0-9a-z]{50}$/);
  });

  it("honors a different gateway on a repeat call for the same event", () => {
    const event = makeEvent({ kind: 15128 });
    const first = getNsiteGatewayUrl(event);
    const second = getNsiteGatewayUrl(event, "example.com");
    expect(first.endsWith(".nsite.lol")).toBe(true);
    expect(second.endsWith(".example.com")).toBe(true);
  });
});

describe("getNsitePaths", () => {
  it("keeps only complete path tags", () => {
    const event = makeEvent({
      tags: [
        ["path", "/index.html", AGGREGATE],
        ["path", "/missing-hash"],
        ["path"],
      ],
    });
    expect(getNsitePaths(event)).toEqual([
      { path: "/index.html", hash: AGGREGATE },
    ]);
  });
});
