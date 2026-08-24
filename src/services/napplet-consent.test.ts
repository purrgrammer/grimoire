// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  describeCapability,
  allowNappletCapability,
  requestLaunchConsent,
  subscribeNappletLaunch,
} from "./napplet-consent";
import { rememberNappletDecision, getNappletDecision } from "./napplet-acl";
import {
  NAP_DOMAINS,
  REMOTE_MEDIA_CAPABILITY,
  capabilitiesForDomains,
} from "./napplet-capabilities";

describe("describeCapability", () => {
  it("falls back to the raw capability rather than pretending to know it", () => {
    expect(describeCapability("nothing:known")).toBe("use nothing:known");
  });

  /**
   * `relay:write` and `outbox:write` both once read "publish events signed as
   * you", so the permissions list showed the same sentence twice with no way
   * to tell which row was which — and revoking one looked like revoking the
   * other. Every capability a user can be asked about has to be tellable apart
   * from every other, because the list is where a grant is taken back.
   */
  it("gives every capability a description no other capability shares", () => {
    const capabilities = [
      ...capabilitiesForDomains(NAP_DOMAINS),
      REMOTE_MEDIA_CAPABILITY,
    ];
    const seen = new Map<string, string>();
    for (const capability of capabilities) {
      const description = describeCapability(capability);
      const owner = seen.get(description);
      expect(
        owner,
        `${capability} and ${owner} both describe themselves as "${description}"`,
      ).toBeUndefined();
      seen.set(description, capability);
    }
  });

  it("describes every capability a domain can require", () => {
    for (const domain of NAP_DOMAINS) {
      for (const capability of capabilitiesForDomains([domain])) {
        expect(
          describeCapability(capability),
          `${domain} requires ${capability}, which has no description`,
        ).not.toBe(`use ${capability}`);
      }
    }
  });
});

describe("allowNappletCapability", () => {
  const D = "dsui-gm-proto";
  const H = "c".repeat(64);

  beforeEach(() => localStorage.clear());

  /**
   * `requestLaunchConsent` treats a remembered deny as final and never offers
   * the capability again, so a napplet whose declared domain was refused —
   * `inc` on a napplet whose buttons emit through it — stays broken with no
   * route back through the flow that broke it. This is that route.
   */
  it("turns a remembered refusal into a grant", () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "relay:write",
      allowed: false,
    });
    expect(getNappletDecision(D, H, "relay:write")?.allowed).toBe(false);

    allowNappletCapability(D, H, "relay:write");

    expect(getNappletDecision(D, H, "relay:write")?.allowed).toBe(true);
  });

  it("leaves other capabilities and other versions alone", () => {
    for (const [hash, capability] of [
      [H, "relay:write"],
      [H, "relay:read"],
      ["d".repeat(64), "relay:write"],
    ] as const) {
      rememberNappletDecision({
        dTag: D,
        aggregateHash: hash,
        capability,
        allowed: false,
      });
    }

    allowNappletCapability(D, H, "relay:write");

    expect(getNappletDecision(D, H, "relay:read")?.allowed).toBe(false);
    expect(getNappletDecision(D, "d".repeat(64), "relay:write")?.allowed).toBe(
      false,
    );
  });
});

describe("requestLaunchConsent", () => {
  const D = "gm";
  const H = "e".repeat(64);
  const base = {
    dTag: D,
    aggregateHash: H,
    title: "Good Morning Protocol",
    pubkey: "f".repeat(64),
    capabilities: ["relay:read"],
  };

  beforeEach(() => localStorage.clear());

  /**
   * `link` carries no capability, so it is never recorded as answered — which
   * meant a dialog whose only content was "these are confirmed individually"
   * reappeared on every launch of every napplet declaring it, forever.
   */
  it("stops explaining unenforceable domains once it has been run", async () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "relay:read",
      allowed: true,
    });

    // First launch: nothing undecided, but the notice has never been shown, so
    // a dialog is raised and left pending.
    let settledFirst = false;
    void requestLaunchConsent({ ...base, unenforceable: ["link"] }).then(
      () => (settledFirst = true),
    );
    await Promise.resolve();
    expect(settledFirst, "a dialog should be pending, not resolved").toBe(
      false,
    );
  });

  it("acknowledges a notice-only dialog even when it is dismissed", async () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "relay:read",
      allowed: true,
    });

    // Nothing undecided, so the dialog exists only to show the notice.
    const pending = requestLaunchConsent({
      ...base,
      unenforceable: ["link"],
    });
    let pendingRequest: { resolve: (a: string[] | null) => void } | undefined;
    const stop = subscribeNappletLaunch((requests) => {
      pendingRequest = requests.at(-1);
    });
    pendingRequest?.resolve(null); // dismissed, not run
    stop();
    await pending;

    // Seeing it is what counts: the next launch must not raise it again.
    const second = await requestLaunchConsent({
      ...base,
      unenforceable: ["link"],
    });
    expect(second).toEqual({ granted: ["relay:read"], cancelled: false });
  });

  it("resolves without a dialog when nothing is undecided and nothing to explain", async () => {
    rememberNappletDecision({
      dTag: D,
      aggregateHash: H,
      capability: "relay:read",
      allowed: true,
    });

    const decision = await requestLaunchConsent({
      ...base,
      unenforceable: [],
    });

    expect(decision).toEqual({ granted: ["relay:read"], cancelled: false });
  });
});
