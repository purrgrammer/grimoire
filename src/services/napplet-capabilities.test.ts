import { describe, it, expect, beforeEach } from "vitest";
import {
  capabilitiesForDomains,
  unenforceableDomains,
  setDeclaredDomains,
  narrowEnvironment,
} from "./napplet-capabilities";

const D = "calc";
const H = "a".repeat(64);

describe("capabilitiesForDomains", () => {
  it("expands a domain to the capabilities it needs", () => {
    expect(capabilitiesForDomains(["storage"])).toEqual([
      "state:read",
      "state:write",
    ]);
  });

  it("dedupes across overlapping domains", () => {
    // inc and relay share the same bits — see the note in the module.
    expect(capabilitiesForDomains(["inc", "relay"])).toEqual([
      "relay:read",
      "relay:write",
    ]);
  });

  it("yields nothing for domains Kehto defines no capability for", () => {
    expect(capabilitiesForDomains(["link", "common", "lists"])).toEqual([]);
  });

  it("ignores unknown domains rather than inventing capabilities", () => {
    expect(capabilitiesForDomains(["nonsense"])).toEqual([]);
  });
});

describe("unenforceableDomains", () => {
  it("names the declared domains that carry no capability", () => {
    expect(unenforceableDomains(["theme", "common", "lists"])).toEqual([
      "common",
      "lists",
    ]);
  });

  it("does not report unknown domains as unenforceable", () => {
    expect(unenforceableDomains(["nonsense"])).toEqual([]);
  });
});

/**
 * The other half of making up-front grants safe. Declaring `inc` requires the
 * same capability bits as `relay.publish`, so the grant alone would escalate;
 * what prevents it is `relay` never being advertised to that napplet.
 */
describe("narrowEnvironment", () => {
  const available = {
    domains: ["shell", "theme", "relay", "inc", "storage"],
    services: ["theme", "outbox"],
  };

  beforeEach(() => {
    setDeclaredDomains(D, H, []);
  });

  it("restricts domains to what the manifest declared", () => {
    setDeclaredDomains(D, H, ["theme"]);
    expect(narrowEnvironment(D, H, available).domains).toEqual([
      "shell",
      "theme",
    ]);
  });

  it("always keeps shell, which is mandatory", () => {
    setDeclaredDomains(D, H, ["theme"]);
    expect(narrowEnvironment(D, H, available).domains).toContain("shell");
  });

  it("withholds relay from a napplet that only declared inc", () => {
    setDeclaredDomains(D, H, ["inc"]);
    const { domains } = narrowEnvironment(D, H, available);
    expect(domains).toContain("inc");
    expect(domains).not.toContain("relay");
  });

  it("narrows services alongside domains", () => {
    setDeclaredDomains(D, H, ["theme"]);
    expect(narrowEnvironment(D, H, available).services).toEqual(["theme"]);
  });

  it("leaves the environment intact when nothing was declared", () => {
    setDeclaredDomains(D, H, []);
    expect(narrowEnvironment(D, H, available)).toEqual(available);
  });

  it("leaves the environment intact for an unknown identity", () => {
    expect(narrowEnvironment("other", H, available)).toEqual(available);
  });

  it("keys on the aggregate hash, so an update does not inherit", () => {
    setDeclaredDomains(D, H, ["theme"]);
    expect(narrowEnvironment(D, "b".repeat(64), available)).toEqual(available);
  });
});
