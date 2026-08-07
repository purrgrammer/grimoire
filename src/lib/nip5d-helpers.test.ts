import { describe, it, expect } from "vitest";
import {
  getNappletTitle,
  getNappletDescription,
  getNappletSource,
  getNappletIdentifier,
  getNappletPaths,
  getNappletServers,
  getNappletRequires,
  getNappletArchetypes,
  getNappletAggregateHash,
} from "./nip5d-helpers";
import type { NostrEvent } from "@/types/nostr";

const HASH = "a".repeat(64);
const AGGREGATE = "b".repeat(64);

function makeEvent(tags: string[][], kind = 35129): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1700000000,
    kind,
    tags,
    content: "",
    sig: "",
  } as NostrEvent;
}

describe("nip5d-helpers", () => {
  it("reads the metadata tags", () => {
    const event = makeEvent([
      ["d", "calculator"],
      ["title", "Calculator"],
      ["description", "adds things"],
      ["source", "https://example.com/src"],
      ["x", AGGREGATE, "aggregate"],
    ]);
    expect(getNappletIdentifier(event)).toBe("calculator");
    expect(getNappletTitle(event)).toBe("Calculator");
    expect(getNappletDescription(event)).toBe("adds things");
    expect(getNappletSource(event)).toBe("https://example.com/src");
    expect(getNappletAggregateHash(event)).toBe(AGGREGATE);
  });

  it("reads paths and servers, which share NIP-5A's schema", () => {
    const event = makeEvent([
      ["path", "/index.html", HASH],
      ["server", "https://blossom.example"],
      ["server", "https://blossom.example"],
    ]);
    expect(getNappletPaths(event)).toEqual([
      { path: "/index.html", hash: HASH },
    ]);
    expect(getNappletServers(event)).toEqual(["https://blossom.example"]);
  });

  it("deduplicates requires and skips valueless tags", () => {
    const event = makeEvent([
      ["requires", "theme"],
      ["requires", "theme"],
      ["requires", "relay"],
      ["requires"],
    ]);
    expect(getNappletRequires(event)).toEqual(["theme", "relay"]);
  });

  it("parses archetype tags, tolerating a missing convention", () => {
    const event = makeEvent([
      ["archetype", "viewer", "nap-viewer/1"],
      ["archetype", "editor"],
      ["archetype"],
    ]);
    expect(getNappletArchetypes(event)).toEqual([
      { slug: "viewer", convention: "nap-viewer/1" },
      { slug: "editor", convention: "" },
    ]);
  });

  it("returns empty values for a bare manifest", () => {
    const event = makeEvent([], 15129);
    expect(getNappletIdentifier(event)).toBeUndefined();
    expect(getNappletAggregateHash(event)).toBeUndefined();
    expect(getNappletPaths(event)).toEqual([]);
    expect(getNappletRequires(event)).toEqual([]);
    expect(getNappletArchetypes(event)).toEqual([]);
  });
});
