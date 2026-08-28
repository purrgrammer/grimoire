import { beforeEach, describe, expect, it, vi } from "vitest";

// The registry's executors are the units under test elsewhere; here only the
// registration mapping matters, and the real ones drag in Dexie and the relay
// pool. `grimoire.window` is a host tool, so it is injected by the test.
vi.mock("@/lib/ai-tools", () => ({
  lookupSpec: vi.fn(async () => ({ ok: true })),
  listSpellsTool: vi.fn(async () => ({ ok: true })),
  proposeCommandTool: vi.fn(async () => ({ ok: true })),
  queryNostr: vi.fn(async () => ({ ok: true })),
  resolveTool: vi.fn(async () => ({ ok: true })),
  draftEvent: vi.fn(async () => ({ ok: true })),
  refuseIfNeeded: vi.fn(() => undefined),
}));

import { toolsForSurface } from "@/lib/ai-registry";
import { modelContextAvailable, registerModelContextTools } from "./webmcp";

interface Registered {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (
    input: object,
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
}

const registered: Registered[] = [];
const signals: (AbortSignal | undefined)[] = [];
let registerTool = vi.fn();

function installModelContext() {
  registerTool = vi.fn(
    async (tool: Registered, options?: { signal?: AbortSignal }) => {
      if (registered.some((existing) => existing.name === tool.name)) {
        throw new DOMException("already registered", "InvalidStateError");
      }
      registered.push(tool);
      signals.push(options?.signal);
      options?.signal?.addEventListener("abort", () => {
        const index = registered.findIndex((t) => t.name === tool.name);
        if (index >= 0) registered.splice(index, 1);
      });
    },
  );
  (globalThis as { document?: unknown }).document = {
    modelContext: { registerTool },
  };
}

beforeEach(() => {
  registered.length = 0;
  signals.length = 0;
  delete (globalThis as { document?: unknown }).document;
});

const host = { "grimoire.window": vi.fn(async () => ({ opened: true })) };

describe("webmcp registration", () => {
  it("reports unsupported where the browser has no modelContext", async () => {
    expect(modelContextAvailable()).toBe(false);

    const result = await registerModelContextTools(host);

    expect(result).toEqual({ supported: false, registered: [], failed: [] });
  });

  it("registers exactly the tools the registry exposes to webmcp", async () => {
    installModelContext();

    const result = await registerModelContextTools(host);

    const expected = toolsForSurface("webmcp").map((tool) => tool.id);
    expect(result.registered).toEqual(expected);
    expect(result.failed).toEqual([]);
    expect(registered.map((tool) => tool.name)).toEqual(expected);
    // Only the tool whose answer is a signing button stays out.
    expect(expected).toContain("grimoire.command");
    expect(expected).not.toContain("nostr.draft");
  });

  it("registers under the canonical dotted id, not the IPA wire name", async () => {
    installModelContext();

    await registerModelContextTools(host);

    expect(registered.map((tool) => tool.name)).toContain("nostr.req");
    expect(registered.map((tool) => tool.name)).not.toContain("nostr_req");
  });

  it("carries title, schema and annotations across", async () => {
    installModelContext();

    await registerModelContextTools(host);

    const req = registered.find((tool) => tool.name === "nostr.req");
    const definition = toolsForSurface("webmcp").find(
      (tool) => tool.id === "nostr.req",
    );
    expect(req?.title).toBe(definition?.title);
    expect(req?.description).toBe(definition?.description);
    expect(req?.inputSchema).toEqual(definition?.parameters);
    // Reading the network is read-only, and everything it returns was written
    // by someone other than the user.
    expect(req?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("skips a host tool nothing supplied rather than registering a stub", async () => {
    installModelContext();

    const result = await registerModelContextTools({});

    expect(result.registered).not.toContain("grimoire.window");
    expect(result.failed).toEqual([]);
  });

  it("runs the injected host executor", async () => {
    installModelContext();
    await registerModelContextTools(host);

    const window = registered.find((tool) => tool.name === "grimoire.window");
    await window?.execute(
      { command: "nip 65" },
      { signal: new AbortController().signal },
    );

    expect(host["grimoire.window"]).toHaveBeenCalledWith({ command: "nip 65" });
  });

  it("unregisters everything when the signal aborts", async () => {
    installModelContext();
    const controller = new AbortController();

    await registerModelContextTools(host, controller.signal);
    expect(registered.length).toBeGreaterThan(0);
    controller.abort();

    expect(registered).toEqual([]);
  });

  it("treats a duplicate name as already registered, not as a failure", async () => {
    installModelContext();

    await registerModelContextTools(host);
    const second = await registerModelContextTools(host);

    expect(second.failed).toEqual([]);
    expect(second.registered).toEqual(
      toolsForSurface("webmcp").map((tool) => tool.id),
    );
  });

  it("reports a refused tool without losing the rest", async () => {
    installModelContext();
    const real = registerTool;
    const stub = globalThis as unknown as {
      document: { modelContext: { registerTool: unknown } };
    };
    stub.document.modelContext.registerTool = vi.fn(
      async (tool: Registered, options?: { signal?: AbortSignal }) => {
        if (tool.name === "nostr.req") {
          throw new DOMException("not origin-keyed", "SecurityError");
        }
        return real(tool, options);
      },
    );

    const result = await registerModelContextTools(host);

    expect(result.failed).toEqual([
      { id: "nostr.req", error: "not origin-keyed" },
    ]);
    expect(result.registered).toContain("nostr.resolve");
  });
});

describe("webmcp results", () => {
  it("answers a thrown executor with an error object, never a rejection", async () => {
    installModelContext();
    await registerModelContextTools({
      "grimoire.window": async () => {
        throw new Error("no such command");
      },
    });

    const window = registered.find((tool) => tool.name === "grimoire.window");
    await expect(
      window?.execute({}, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      error: "grimoire.window failed: no such command",
    });
  });

  it("answers with an error object when a result cannot be serialized", async () => {
    installModelContext();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await registerModelContextTools({
      "grimoire.window": async () => circular,
    });

    const window = registered.find((tool) => tool.name === "grimoire.window");
    await expect(
      window?.execute({}, { signal: new AbortController().signal }),
    ).resolves.toEqual({
      error: "This tool produced a result that could not be serialized.",
    });
  });

  it("hands back a value the user agent can serialize", async () => {
    installModelContext();
    await registerModelContextTools(host);

    const window = registered.find((tool) => tool.name === "grimoire.window");
    const result = await window?.execute(
      { command: "nip 65" },
      { signal: new AbortController().signal },
    );

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result).toEqual({ opened: true });
  });
});
