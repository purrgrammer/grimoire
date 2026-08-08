import { describe, it, expect, beforeEach } from "vitest";
import {
  labelOf,
  recordNappletMessage,
  getNappletMessages,
  clearNappletMessages,
  setNappletMessageRecording,
  isNappletMessageRecording,
  buildNappletTapScript,
  injectNappletTap,
  TAP_CONTROL,
  TAP_MESSAGE,
} from "./napplet-messages";

const W = "window-1";

beforeEach(() => {
  clearNappletMessages(W);
  clearNappletMessages("other");
  setNappletMessageRecording(W, false);
  setNappletMessageRecording("other", false);
});

describe("labelOf", () => {
  it("reads the type from a NIP-5D envelope", () => {
    expect(labelOf({ type: "identity.get" })).toBe("identity.get");
  });

  it("reads verb and subscription id from a NIP-01 array", () => {
    expect(labelOf(["EVENT", "sub-1", { id: "x" }])).toBe("EVENT:sub-1");
  });

  it("falls back rather than throwing on anything else", () => {
    expect(labelOf(null)).toBe("?");
    expect(labelOf("nope")).toBe("?");
    expect(labelOf({})).toBe("?");
    expect(labelOf([])).toBe("?");
  });
});

describe("recording gate", () => {
  // The gate is the reason a napplet streaming a timeline costs nothing when
  // nobody is looking. If it regresses, every envelope gets JSON.stringify'd.
  it("drops messages for windows that are not recording", () => {
    recordNappletMessage({ windowId: W, direction: "in", data: { type: "a" } });
    expect(getNappletMessages(W)).toHaveLength(0);
  });

  it("records once switched on", () => {
    setNappletMessageRecording(W, true);
    expect(isNappletMessageRecording(W)).toBe(true);
    recordNappletMessage({ windowId: W, direction: "in", data: { type: "a" } });
    expect(getNappletMessages(W)).toHaveLength(1);
  });

  it("keeps windows separate", () => {
    setNappletMessageRecording(W, true);
    setNappletMessageRecording("other", true);
    recordNappletMessage({ windowId: W, direction: "in", data: { type: "a" } });
    recordNappletMessage({
      windowId: "other",
      direction: "in",
      data: { type: "b" },
    });
    expect(getNappletMessages(W).map((e) => e.label)).toEqual(["a"]);
    expect(getNappletMessages("other").map((e) => e.label)).toEqual(["b"]);
  });
});

describe("entries", () => {
  beforeEach(() => setNappletMessageRecording(W, true));

  it("is bounded, keeping the newest", () => {
    for (let i = 0; i < 700; i++) {
      recordNappletMessage({
        windowId: W,
        direction: "in",
        data: { type: `m${i}` },
      });
    }
    const entries = getNappletMessages(W);
    expect(entries).toHaveLength(500);
    expect(entries[entries.length - 1].label).toBe("m699");
  });

  it("clamps a large payload rather than holding it whole", () => {
    recordNappletMessage({
      windowId: W,
      direction: "in",
      data: { type: "big", content: "x".repeat(50_000) },
    });
    const [entry] = getNappletMessages(W);
    expect(entry.payload.length).toBeLessThan(5000);
    expect(entry.payload).toContain("truncated");
  });

  it("survives an unserializable envelope", () => {
    const cyclic: Record<string, unknown> = { type: "loop" };
    cyclic.self = cyclic;
    recordNappletMessage({ windowId: W, direction: "in", data: cyclic });
    const [entry] = getNappletMessages(W);
    expect(entry.label).toBe("loop");
    expect(entry.payload).toBe("[unserializable]");
  });

  it("carries the allow/deny verdict for acl entries", () => {
    recordNappletMessage({
      windowId: W,
      direction: "acl",
      label: "relay:write",
      allowed: false,
      data: null,
    });
    expect(getNappletMessages(W)[0]).toMatchObject({
      direction: "acl",
      label: "relay:write",
      allowed: false,
    });
  });
});

describe("the in-frame tap", () => {
  const script = buildNappletTapScript();

  // The tap runs inside an attacker-controlled document. It must not be the
  // thing that makes a napplet chatty by default, and it must be reachable only
  // through the reserved control message.
  it("installs dormant", () => {
    expect(script).toContain("var on = false");
  });

  it("names both reserved envelopes", () => {
    expect(script).toContain(JSON.stringify(TAP_CONTROL));
    expect(script).toContain(JSON.stringify(TAP_MESSAGE));
  });

  it("captures postMessage before napplet code can replace it", () => {
    expect(script.indexOf("window.parent.postMessage.bind")).toBeLessThan(
      script.indexOf("addEventListener"),
    );
  });

  it("ignores anything not sent by the host", () => {
    expect(script).toContain("event.source !== window.parent");
  });

  it("appends after the document it is given", () => {
    const html = injectNappletTap("<html><head></head><body>hi</body></html>");
    expect(html.indexOf("hi")).toBeLessThan(html.indexOf("__grimoire_tap__"));
  });
});
