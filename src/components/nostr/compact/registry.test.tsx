// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Static rather than per-test: the registry pulls every compact preview, and
// with them RichText, through jsdom. `vi.mock` is hoisted above it either way.
import { compactRenderers } from "./index";
import {
  GitStatusCompactPreview,
  GitTicketCompactPreview,
  PullRequestUpdateCompactPreview,
  RepositoryCompactPreview,
  RepositoryStateCompactPreview,
} from "./GitCompactPreviews";

vi.mock("@/core/state", () => ({
  useGrimoire: () => ({ locale: { locale: "en-US" } }),
  useAddWindow: () => vi.fn(),
}));

describe("compact preview registry", () => {
  it("gives every NIP-34 kind Grimoire renders a git preview", () => {
    expect(compactRenderers[1617]).toBe(GitTicketCompactPreview);
    expect(compactRenderers[1618]).toBe(GitTicketCompactPreview);
    expect(compactRenderers[1621]).toBe(GitTicketCompactPreview);
    expect(compactRenderers[1619]).toBe(PullRequestUpdateCompactPreview);
    for (const kind of [1630, 1631, 1632, 1633]) {
      expect(compactRenderers[kind]).toBe(GitStatusCompactPreview);
    }
    expect(compactRenderers[30617]).toBe(RepositoryCompactPreview);
    expect(compactRenderers[30618]).toBe(RepositoryStateCompactPreview);
  });

  it("leaves the previews that were already registered in place", () => {
    for (const kind of [6, 7, 16, 9735, 8333, 1222, 1244]) {
      expect(compactRenderers[kind]).toBeDefined();
    }
    // Deprecated by NIP-34 and never given a renderer here: still the default.
    expect(compactRenderers[1622]).toBeUndefined();
  });
});
