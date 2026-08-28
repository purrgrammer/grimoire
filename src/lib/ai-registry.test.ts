import { describe, expect, it, vi } from "vitest";

// Executors are not under test here — only the contract each definition
// carries — and the real ones reach for Dexie and the relay pool.
vi.mock("./ai-tools", () => ({
  lookupSpec: vi.fn(),
  listSpellsTool: vi.fn(),
  proposeCommandTool: vi.fn(),
  queryNostr: vi.fn(),
  resolveTool: vi.fn(),
  draftEvent: vi.fn(),
  refuseIfNeeded: vi.fn(),
}));

import {
  AI_TOOLS,
  TOOL_REGISTRY,
  canonicalId,
  describeTools,
  toolsForSurface,
  wireName,
} from "./ai-registry";

/** WebMCP's name grammar: ASCII alphanumeric, `_`, `-`, `.`, at most 128. */
const WEBMCP_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/** OpenAI-shaped function names, which is what IPA relays to a provider. */
const IPA_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

describe("the tool registry", () => {
  it("gives every tool a surface, a title and a description", () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.surfaces.length, tool.id).toBeGreaterThan(0);
      expect(tool.title.trim(), tool.id).not.toBe("");
      expect(tool.description.trim(), tool.id).not.toBe("");
    }
  });

  it("names every tool legally on both surfaces", () => {
    for (const tool of TOOL_REGISTRY) {
      // WebMCP registers the canonical id; IPA registers the mangled one.
      expect(tool.id, tool.id).toMatch(WEBMCP_NAME);
      expect(wireName(tool.id), tool.id).toMatch(IPA_NAME);
    }
  });

  it("keeps ids unique — a duplicate name is a rejected registration", () => {
    const ids = TOOL_REGISTRY.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hands IPA only the tools marked for it", () => {
    expect(AI_TOOLS.map((tool) => tool.function.name)).toEqual(
      toolsForSurface("ipa").map((tool) => wireName(tool.id)),
    );
  });

  it("describes IPA's tools in the prompt, and only those", () => {
    const prose = describeTools();
    for (const tool of TOOL_REGISTRY) {
      const mentioned = prose.includes(`\`${tool.id}\``);
      expect(mentioned, tool.id).toBe(tool.surfaces.includes("ipa"));
    }
  });

  it("keeps only the signing tool off the webmcp surface", () => {
    // `nostr.draft` answers with a card that carries a signing button, and
    // outside Hex's reply there is nothing for the user to press — so the
    // consent step the tool exists for would be missing. Everything else is
    // reachable by the browser's agent.
    const exposed = toolsForSurface("webmcp").map((tool) => tool.id);
    expect(exposed).toEqual(
      TOOL_REGISTRY.filter((tool) => tool.id !== "nostr.draft").map(
        (tool) => tool.id,
      ),
    );
  });

  it("still answers to the name a stored transcript holds", () => {
    // The id is a contract: conversations persist and a published agent
    // definition names tools by it, so a rename has to keep resolving.
    expect(canonicalId("nostr.publish")).toBe("nostr.draft");
    expect(canonicalId("nostr_publish")).toBe("nostr.draft");
    expect(canonicalId("nostr.draft")).toBe("nostr.draft");
  });

  it("says a webmcp tool's whole contract in its own description", () => {
    // A WebMCP agent never sees `prompt`: no system prompt of grimoire's
    // reaches it. Anything it must know to call correctly lives in the
    // description or a parameter's, so those cannot be one-liners.
    for (const tool of toolsForSurface("webmcp")) {
      expect(tool.description.length, tool.id).toBeGreaterThan(80);
    }
  });

  it("marks every tool that only reads as read-only", () => {
    const writes = TOOL_REGISTRY.filter(
      (tool) => !tool.annotations.readOnlyHint,
    ).map((tool) => tool.id);
    // `grimoire.window` changes what the user is looking at; `nostr.draft`
    // produces a draft to sign. Nothing else changes anything.
    expect(writes).toEqual(["grimoire.window", "nostr.draft"]);
  });

  it("marks every tool that returns other people's writing as untrusted", () => {
    const untrusted = TOOL_REGISTRY.filter(
      (tool) => tool.annotations.untrustedContentHint,
    ).map((tool) => tool.id);
    expect(untrusted).toEqual(["nostr.req", "nostr.resolve"]);
  });
});
