import { describe, expect, it } from "vitest";

import { describeCapability } from "./napplet-consent";
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
