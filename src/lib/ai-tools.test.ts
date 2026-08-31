import { describe, expect, it, vi, beforeEach } from "vitest";
import { nip19 } from "nostr-tools";
import { EMPTY } from "rxjs";

const requestEvents = vi.fn();
const getNipText = vi.fn();

vi.mock("./relay-subscription", () => ({
  requestEvents: (...args: unknown[]) => requestEvents(...args),
}));

vi.mock("@/services/nip-text", () => ({
  getNipText: (...args: unknown[]) => getNipText(...args),
}));

vi.mock("@/services/loaders", () => ({
  FALLBACK_RELAYS: ["wss://default.example"],
  addressLoader: (...args: unknown[]) => addressLoader(...args),
  eventLoader: (...args: unknown[]) => eventLoader(...args),
}));

const eventLoader = vi.fn();

const addressLoader = vi.fn();
const accounts: { active?: { pubkey: string } } = {};
const getReplaceable = vi.fn();

vi.mock("@/services/accounts", () => ({ default: accounts }));
const spellsToArray = vi.fn();

vi.mock("@/services/db", () => ({
  default: { spells: { toArray: () => spellsToArray() } },
  // The command catalogue pulls in the man pages, which reach the relay
  // singletons; they need this at module init.
  relayLivenessStorage: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));

vi.mock("@/services/event-store", () => ({
  default: {
    getReplaceable: (...args: unknown[]) => getReplaceable(...args),
    getEvent: (...args: unknown[]) => getEvent(...args),
  },
}));

const getEvent = vi.fn();

const { refuseIfNeeded } = await import("./ai-tools");
const { AI_TOOLS, canonicalId, createToolExecutors, wireName } =
  await import("./ai-registry");

function eventFor(id: string, content = "hello") {
  return {
    id,
    kind: 1,
    pubkey: "a".repeat(64),
    created_at: 1,
    tags: [],
    content,
    sig: "x",
  };
}

const openWindow = vi.fn();
const executors = createToolExecutors({ "grimoire.window": openWindow });

/** Call a tool the way the loop does: by the name the provider was given. */
function call(id: string, args: unknown): Promise<unknown> {
  return executors[wireName(id)](args);
}

beforeEach(() => {
  requestEvents.mockReset();
  getNipText.mockReset();
  openWindow.mockReset();
  getReplaceable.mockReset();
  getEvent.mockReset();
  spellsToArray.mockReset();
  spellsToArray.mockResolvedValue([]);
  addressLoader.mockReset();
  eventLoader.mockReset();
  accounts.active = undefined;
  requestEvents.mockResolvedValue([]);
  getNipText.mockResolvedValue(undefined);
});

describe("the tool surface", () => {
  it("is namespaced, and every name shows in the permission prompt", () => {
    expect(
      AI_TOOLS.map(
        (tool: { function: { name: string } }) => tool.function.name,
      ),
    ).toEqual([
      "grimoire_help",
      "grimoire_spells",
      "grimoire_command",
      "grimoire_window",
      "nostr_req",
      "nostr_resolve",
      "nostr_draft",
    ]);
  });

  it("sends the namespace as an underscore, because a dot is not portable", () => {
    // OpenAI-shaped function names are `^[a-zA-Z0-9_-]{1,64}$`, and IPA relays
    // to whichever provider the extension holds a key for.
    for (const tool of AI_TOOLS as { function: { name: string } }[]) {
      expect(tool.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it("maps a wire name, a legacy name, and an id to the same tool", () => {
    expect(canonicalId("nostr_req")).toBe("nostr.req");
    // Conversations persist: a transcript from before the registry says this.
    expect(canonicalId("query_nostr")).toBe("nostr.req");
    expect(canonicalId("nostr.req")).toBe("nostr.req");
    // Something the model invented stays itself rather than becoming a tool.
    expect(canonicalId("rm_rf")).toBe("rm_rf");
    // Renamed after transcripts already stored it: `publish` said the one
    // thing the tool does not do.
    expect(canonicalId("nostr_publish")).toBe("nostr.draft");
    expect(canonicalId("nostr.publish")).toBe("nostr.draft");
  });

  it("has no executor that signs or spends", () => {
    // `nostr.draft` drafts; the signature happens on a button press, in
    // `publishDraft`, which no executor can reach.
    const ids = [...new Set(Object.keys(executors).map(canonicalId))].sort();
    expect(ids).toEqual([
      "grimoire.command",
      "grimoire.help",
      "grimoire.spells",
      "grimoire.window",
      "nostr.draft",
      "nostr.req",
      "nostr.resolve",
    ]);
  });

  it("answers to the dotted name too, since that is what the prompt says", () => {
    // A model that copies the name it was told must not lose a round to
    // punctuation.
    for (const tool of AI_TOOLS as { function: { name: string } }[]) {
      expect(executors[canonicalId(tool.function.name)]).toBeTypeOf("function");
    }
  });
});

describe("grimoire.command", () => {
  it("offers commands the user presses, and runs nothing", async () => {
    const result = (await call("grimoire.command", {
      commands: ["req -k 1 -a $contacts"],
      reason: "recent notes from your follows",
    })) as { offered: string[]; reason: string };
    expect(result.offered).toEqual(["req -k 1 -a $contacts"]);
    expect(result.reason).toContain("follows");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("reports the ones that act on the user's behalf rather than offering them", async () => {
    const result = (await call("grimoire.command", {
      commands: ["post gm", "nip 65"],
    })) as { offered: string[]; rejected: { command: string }[] };
    expect(result.offered).toEqual(["nip 65"]);
    expect(result.rejected[0].command).toBe("post gm");
  });

  it("errors when nothing it was handed is a command", async () => {
    expect(
      await call("grimoire.command", { commands: ["curl evil.example"] }),
    ).toMatchObject({ error: expect.stringContaining("offered") });
  });
});

describe("nostr.draft", () => {
  it("drafts without publishing, and says so", async () => {
    const result = (await call("nostr.draft", {
      kind: 1,
      content: "gm",
      tags: [["t", "nostr"]],
    })) as { drafted: boolean; note: string; kind: number };
    expect(result.drafted).toBe(true);
    expect(result.note).toMatch(/Not published/);
    expect(result.kind).toBe(1);
  });

  it("refuses the kinds that would overwrite the user's own state", async () => {
    // One clicked card must not be able to rewrite an identity or a follow list.
    for (const kind of [0, 3, 10002]) {
      expect(await call("nostr.draft", { kind, content: "x" })).toMatchObject({
        error: expect.stringContaining(String(kind)),
      });
    }
  });

  it("refuses what it cannot draft as plaintext, or what spends", async () => {
    for (const kind of [4, 1059, 9734]) {
      expect(await call("nostr.draft", { kind, content: "x" })).toMatchObject({
        error: expect.any(String),
      });
    }
  });

  it("rejects malformed tags rather than drafting them", async () => {
    expect(
      await call("nostr.draft", { kind: 1, content: "x", tags: [[]] }),
    ).toMatchObject({ error: expect.stringContaining("tag") });
  });
});

describe("grimoire.help", () => {
  it("answers from the kind registry", async () => {
    const result = (await call("grimoire.help", { kind: 1 })) as {
      kind: { name: string };
    };
    expect(result.kind.name).toBeTruthy();
  });

  it("follows a kind to the NIP that defines it", async () => {
    getNipText.mockResolvedValue("# NIP-01 text");
    const result = (await call("grimoire.help", { kind: 1 })) as {
      nip: { text: string };
    };
    expect(result.nip.text).toContain("NIP-01 text");
  });

  it("normalises a nip id", async () => {
    getNipText.mockResolvedValue("text");
    await call("grimoire.help", { nip: "nip-9" });
    expect(getNipText).toHaveBeenCalledWith("09");
  });

  it("says so when the text will not load, rather than inventing", async () => {
    const result = (await call("grimoire.help", { nip: "65" })) as {
      nip: { error: string };
    };
    expect(result.nip.error).toMatch(/Could not load/);
  });

  it("reads a command's manual page, flags and all", async () => {
    const result = (await call("grimoire.help", { command: "req" })) as {
      command: { synopsis: string; options?: unknown[] };
    };
    expect(result.command.synopsis).toContain("req");
    expect(result.command.options?.length).toBeGreaterThan(0);
  });

  it("enumerates the commands, so a model cannot ask for one that is not there", () => {
    const help = (
      AI_TOOLS as { function: { name: string; parameters: unknown } }[]
    ).find((tool) => tool.function.name === "grimoire_help");
    const schema = help!.function.parameters as {
      properties: { command: { enum?: string[] } };
    };
    const names = schema.properties.command.enum ?? [];
    expect(names).toContain("req");
    // The prompt's catalogue hides these, so the lookup must not offer them.
    expect(names).not.toContain("zap");
    expect(names).not.toContain("post");
    expect(names).not.toContain("wallet");
  });

  it("still answers as data when a provider ignores the enum", async () => {
    const result = (await call("grimoire.help", { command: "frobnicate" })) as {
      command: { error: string };
    };
    expect(result.command.error).toContain("req");
  });

  it("will not read the manual of a command it may not propose", async () => {
    const result = (await call("grimoire.help", { command: "zap" })) as {
      command: { error: string };
    };
    expect(result.command.error).toContain("No such command");
  });

  it("rejects an empty call", async () => {
    expect(await call("grimoire.help", {})).toMatchObject({
      error: expect.stringContaining("nip id"),
    });
  });
});

describe("nostr.req", () => {
  it("refuses a filter that constrains nothing", async () => {
    expect(await call("nostr.req", { limit: 10 })).toMatchObject({
      error: expect.stringContaining("at least one"),
    });
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("passes the limit the model asked for", async () => {
    // How many events a question needs is the model's call, not a number here.
    await call("nostr.req", { kinds: [1], limit: 200 });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], limit: 200 }],
    );
  });

  it("bounds an absurd limit, because the page has to survive the answer", async () => {
    // Not a policy: the result renders as events and goes back as JSON, so a
    // five-figure answer freezes the pane and kills the turn.
    await call("nostr.req", { kinds: [1], limit: 50_000 });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], limit: 500 }],
    );
  });

  it("sends a search to the user's own search relays", async () => {
    // NIP-50 is optional: the general set ignores `search` and answers with its
    // newest events, which looks like a working query and is not one.
    accounts.active = { pubkey: "e".repeat(64) };
    getReplaceable.mockImplementation((kind: number) =>
      kind === 10_007
        ? {
            kind: 10_007,
            tags: [
              ["relay", "wss://search.mine.example/"],
              // Whatever someone's client wrote: a `relay` tag is not checked
              // anywhere upstream. A bare hostname would be legitimate (a
              // localhost relay is), so this is something that cannot be one.
              ["relay", ""],
              ["relay", "https://not-a-relay.example/rss"],
            ],
          }
        : undefined,
    );

    await call("nostr.req", { kinds: [1], search: "purple" });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://search.mine.example/"],
      [{ kinds: [1], search: "purple", limit: 5 }],
    );
  });

  it("falls back to a search relay when the user has no list", async () => {
    accounts.active = { pubkey: "e".repeat(64) };
    getReplaceable.mockReturnValue(undefined);
    await call("nostr.req", { kinds: [1], search: "purple" });
    expect(requestEvents.mock.calls[0][0]).toEqual(["wss://search.nos.today/"]);
  });

  it("leaves a non-search query on the general set", async () => {
    accounts.active = { pubkey: "e".repeat(64) };
    getReplaceable.mockImplementation((kind: number) =>
      kind === 10_007
        ? { kind: 10_007, tags: [["relay", "wss://search.mine.example/"]] }
        : undefined,
    );
    await call("nostr.req", { kinds: [1] });
    expect(requestEvents.mock.calls[0][0]).toEqual(["wss://default.example"]);
  });

  it("still honours a relay the user named through the model", async () => {
    await call("nostr.req", {
      kinds: [1],
      search: "purple",
      relays: ["wss://named.example"],
    });
    expect(requestEvents.mock.calls[0][0]).toEqual(["wss://named.example"]);
  });

  it("defaults to a peek when the model names no limit", async () => {
    await call("nostr.req", { kinds: [1] });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], limit: 5 }],
    );
  });

  it("drops authors that are not hex pubkeys", async () => {
    await call("nostr.req", {
      kinds: [0],
      authors: ["npub1whatever", "b".repeat(64)],
    });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [0], authors: ["b".repeat(64)], limit: 5 }],
    );
  });

  it("passes the rest of a NIP-01 filter through", async () => {
    await call("nostr.req", {
      ids: ["d".repeat(64)],
      since: 1_700_000_000.7,
      until: 1_800_000_000,
      search: "  purple  ",
      tags: { t: ["nostr"], "#e": ["f".repeat(64)] },
    });
    // Relays are asserted by the search-routing tests below; this one is about
    // the filter, which carries `search` and so does not go to the general set.
    expect(requestEvents).toHaveBeenCalledWith(expect.any(Array), [
      {
        ids: ["d".repeat(64)],
        since: 1_700_000_000,
        until: 1_800_000_000,
        search: "purple",
        "#t": ["nostr"],
        "#e": ["f".repeat(64)],
        limit: 5,
      },
    ]);
  });

  it("rejects a tag that is not single-letter, because relays do not index it", async () => {
    expect(
      await call("nostr.req", { kinds: [1], tags: { hashtag: ["x"] } }),
    ).toMatchObject({ error: expect.stringContaining("single-letter") });
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("rejects a window that cannot contain anything", async () => {
    expect(
      await call("nostr.req", { kinds: [1], since: 200, until: 100 }),
    ).toMatchObject({ error: expect.stringContaining("since is after until") });
  });

  it("resolves $me from the active account", async () => {
    accounts.active = { pubkey: "e".repeat(64) };
    await call("nostr.req", { kinds: [1], authors: ["$ME"] });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], authors: ["e".repeat(64)], limit: 5 }],
    );
  });

  it("says so rather than querying when $me has no account", async () => {
    expect(
      await call("nostr.req", { kinds: [1], authors: ["$me"] }),
    ).toMatchObject({ error: expect.stringContaining("No account") });
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("expands $contacts from the stored contact list", async () => {
    accounts.active = { pubkey: "e".repeat(64) };
    getReplaceable.mockReturnValue({
      tags: [
        ["p", "a".repeat(64)],
        ["p", "not-hex"],
        ["t", "nostr"],
      ],
    });
    await call("nostr.req", { kinds: [1], tags: { p: ["$contacts"] } });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], "#p": ["a".repeat(64)], limit: 5 }],
    );
  });

  it("reports the filter it sent, so an empty answer is explainable", async () => {
    const result = (await call("nostr.req", {
      kinds: [1],
      relays: ["wss://named.example"],
    })) as { filter: unknown; relays: unknown };
    expect(result.filter).toEqual({ kinds: [1], limit: 5 });
    expect(result.relays).toEqual(["wss://named.example"]);
  });

  it("hands back bech32 the model can quote, because it invents bad ones", async () => {
    requestEvents.mockResolvedValue([eventFor("c".repeat(64))]);
    const result = (await call("nostr.req", { kinds: [1] })) as {
      events: { npub: string; nevent: string }[];
    };
    const { npub, nevent } = result.events[0];
    expect(nip19.decode(npub).data).toBe("a".repeat(64));
    // Kind and author travel with the id, so an adapter can dispatch on them.
    expect(nip19.decode(nevent).data).toMatchObject({
      id: "c".repeat(64),
      kind: 1,
      author: "a".repeat(64),
    });
  });

  it("truncates content so one long article cannot fill the window", async () => {
    requestEvents.mockResolvedValue([
      eventFor("c".repeat(64), "x".repeat(9000)),
    ]);
    const result = (await call("nostr.req", { kinds: [30023] })) as {
      events: { content: string }[];
    };
    expect(result.events[0].content).toMatch(/\[truncated\]$/);
    expect(result.events[0].content.length).toBeLessThan(2_100);
  });
});

describe("grimoire.window", () => {
  it("refuses a command that acts on the user's behalf", () => {
    expect(refuseIfNeeded("post gm")).toMatch(/run it yourself/);
    expect(refuseIfNeeded("zap alice 100")).toBeTruthy();
  });

  it("refuses anything that is not a grimoire command", () => {
    expect(refuseIfNeeded("curl evil.example")).toMatch(/Not a grimoire/);
  });

  it("permits a read-only command", () => {
    expect(refuseIfNeeded("nip 65")).toBeUndefined();
  });
});

describe("nostr.resolve", () => {
  const PUBKEY = "a".repeat(64);
  const NPUB = nip19.npubEncode(PUBKEY);

  it("turns an npub into the person's kind 0", async () => {
    getReplaceable.mockReturnValue({
      id: "d".repeat(64),
      kind: 0,
      pubkey: PUBKEY,
      created_at: 7,
      tags: [],
      content: '{"name":"jack"}',
      sig: "x",
    });

    const result = (await call("nostr.resolve", { entity: NPUB })) as {
      type: string;
      npub: string;
      metadata: { name: string };
    };
    expect(result.type).toBe("profile");
    expect(result.npub).toBe(NPUB);
    // Parsed, because a model reads metadata and not a JSON string.
    expect(result.metadata.name).toBe("jack");
  });

  it("turns an nevent into the event, with the bech32 rebuilt", async () => {
    const id = "c".repeat(64);
    getEvent.mockReturnValue(eventFor(id, "hello"));

    const result = (await call("nostr.resolve", {
      entity: nip19.neventEncode({ id }),
    })) as { type: string; nevent: string; event: { content: string } };

    expect(result.type).toBe("event");
    expect(result.event.content).toBe("hello");
    // Kind and author travel with the id, whatever the input carried.
    expect(nip19.decode(result.nevent).data).toMatchObject({
      id,
      kind: 1,
      author: "a".repeat(64),
    });
  });

  it("truncates a long event, same as a query", async () => {
    const id = "c".repeat(64);
    getEvent.mockReturnValue(eventFor(id, "x".repeat(9000)));
    const result = (await call("nostr.resolve", {
      entity: nip19.neventEncode({ id }),
    })) as { event: { content: string } };
    expect(result.event.content).toMatch(/\[truncated\]$/);
  });

  it("rejects something that is not an entity", async () => {
    expect(await call("nostr.resolve", { entity: "jack" })).toMatchObject({
      error: expect.stringContaining("Not a Nostr entity"),
    });
  });

  it("says an event could not be loaded rather than letting one be invented", async () => {
    const id = "e".repeat(64);
    getEvent.mockReturnValue(undefined);
    eventLoader.mockReturnValue(EMPTY);

    expect(
      await call("nostr.resolve", { entity: nip19.neventEncode({ id }) }),
    ).toMatchObject({ error: expect.stringContaining("no relay returned it") });
  });
});

describe("spells", () => {
  const SPELLS = [
    {
      id: "1",
      alias: "btc",
      name: "Bitcoin talk",
      command: "req -k 1 -t bitcoin -l 50",
      createdAt: 1,
      isPublished: true,
    },
    {
      id: "2",
      name: "Old one",
      command: "req -k 1 -l 5",
      createdAt: 2,
      isPublished: false,
      deletedAt: 3,
    },
  ];

  it("lists the saved ones, minus what was deleted", async () => {
    spellsToArray.mockResolvedValue(SPELLS);
    const result = (await call("grimoire.spells", {})) as {
      count?: number;
      spells: { alias?: string }[];
    };
    expect(result.spells).toEqual([
      {
        alias: "btc",
        name: "Bitcoin talk",
        command: "req -k 1 -t bitcoin -l 50",
        published: true,
      },
    ]);
  });

  it("finds one by alias, so its filter can be run rather than guessed", async () => {
    spellsToArray.mockResolvedValue(SPELLS);
    const result = (await call("grimoire.spells", { alias: "BTC" })) as {
      command: string;
    };
    expect(result.command).toBe("req -k 1 -t bitcoin -l 50");
  });

  it("says an unknown alias is unknown rather than inventing a command", async () => {
    spellsToArray.mockResolvedValue(SPELLS);
    const result = (await call("grimoire.spells", { alias: "nope" })) as {
      error: string;
    };
    expect(result.error).toContain("No spell");
  });

  it("survives an unreadable store", async () => {
    spellsToArray.mockRejectedValue(new Error("dexie is upset"));
    const result = (await call("grimoire.spells", {})) as { error: string };
    expect(result.error).toContain("Could not read");
  });
});
