import { describe, expect, it, vi } from "vitest";

// Executors are not under test here — only the contract each definition
// carries — and the real ones reach for Dexie and the relay pool.
vi.mock("./ai-tools", () => ({
  lookupSpec: vi.fn(),
  listSpellsTool: vi.fn(),
  proposeCommandTool: vi.fn(),
  queryNostr: vi.fn(),
  resolveTool: vi.fn(),
  refuseIfNeeded: vi.fn(),
}));

import { TOOL_REGISTRY } from "./ai-registry";

/** WebMCP's name grammar: ASCII alphanumeric, `_`, `-`, `.`, at most 128. */
const WEBMCP_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

describe("the tool registry", () => {
  it("gives every tool a title and a description", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.title.trim(), tool.id).not.toBe("");
      expect(tool.description.trim(), tool.id).not.toBe("");
    }
  });

  it("names every tool legally for WebMCP", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.id, tool.id).toMatch(WEBMCP_NAME);
    }
  });

  it("keeps ids unique — a duplicate name is a rejected registration", () => {
    const ids = TOOL_REGISTRY.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers no tool that drafts, signs or publishes", () => {
    expect(TOOL_REGISTRY.map((tool) => tool.id)).toEqual([
      "grimoire.help",
      "grimoire.spells",
      "grimoire.command",
      "grimoire.window",
      "nostr.req",
      "nostr.resolve",
    ]);
  });

  it("says each tool's whole contract in its own description", () => {
    // A WebMCP agent sees the description, the parameter descriptions and the
    // annotations — nothing else — so those cannot be one-liners.
    for (const tool of TOOL_REGISTRY) {
      expect(tool.description.length, tool.id).toBeGreaterThan(80);
    }
  });

  it("marks every tool that only reads as read-only", () => {
    const writes = TOOL_REGISTRY.filter(
      (tool) => !tool.annotations.readOnlyHint,
    ).map((tool) => tool.id);
    // `grimoire.window` changes what the user is looking at. Nothing else
    // changes anything.
    expect(writes).toEqual(["grimoire.window"]);
  });

  it("marks every tool that returns other people's writing as untrusted", () => {
    const untrusted = TOOL_REGISTRY.filter(
      (tool) => tool.annotations.untrustedContentHint,
    ).map((tool) => tool.id);
    expect(untrusted).toEqual(["nostr.req", "nostr.resolve"]);
  });
});
