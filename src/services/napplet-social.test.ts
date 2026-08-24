import { describe, expect, it } from "vitest";

import { resolveNostrLink } from "./napplet-social";

/**
 * NAP-LINK used to allow `https:` and nothing else, so a napplet's "open this
 * note" button was answered `denied` — with no prompt, no toast and no console
 * line, which reads as a broken button rather than a refusal. `nostr:` names
 * something grimoire already renders, so it opens a window here instead.
 */
describe("resolveNostrLink", () => {
  it("sends a person to the profile built-in", () => {
    expect(resolveNostrLink("nostr:npub1abcdef")).toEqual({
      archetype: "profile",
      entity: "npub1abcdef",
    });
    expect(resolveNostrLink("nostr:nprofile1abcdef")?.archetype).toBe(
      "profile",
    );
  });

  it("sends a thing to the event built-in", () => {
    for (const entity of ["note1abc", "nevent1abc", "naddr1abc"]) {
      expect(resolveNostrLink(`nostr:${entity}`)).toEqual({
        archetype: "event",
        entity,
      });
    }
  });

  it("reads the authority form too, because napplets write both", () => {
    expect(resolveNostrLink("nostr://nevent1abc")).toEqual({
      archetype: "event",
      entity: "nevent1abc",
    });
  });

  /**
   * The whole point of an allowlist. A napplet naming one of these is trying
   * to reach outside what NAP-LINK is for, and `open` must never see it.
   */
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://example.com",
    "nostr:",
    "nostr:not-an-entity",
    "nostr:npub",
    "not a url at all",
  ])("refuses %s", (url) => {
    expect(resolveNostrLink(url)).toBeNull();
  });
});
