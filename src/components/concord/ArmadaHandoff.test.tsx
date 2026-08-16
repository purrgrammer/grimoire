// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  ARMADA_URL,
  NoCommunitiesEmpty,
  StrandedBanner,
} from "./ArmadaHandoff";

describe("NoCommunitiesEmpty", () => {
  it("sends the reader to Armada in a new tab, safely", () => {
    render(<NoCommunitiesEmpty />);
    const link = screen.getByText("Open Armada").closest("a");
    expect(link?.getAttribute("href")).toBe(ARMADA_URL);
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("says it is the same key on both sides that makes the list appear", () => {
    // The failure this state actually covers is signing in with a different
    // key, which looks identical to having joined nothing.
    render(<NoCommunitiesEmpty />);
    expect(screen.getByText(/same\s+Nostr key/)).toBeTruthy();
  });

  it("offers a re-read for the list that has only just been published", () => {
    const onRefresh = vi.fn();
    render(<NoCommunitiesEmpty onRefresh={onRefresh} />);
    fireEvent.click(screen.getByText("Check again"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows no button when there is nothing to re-read with", () => {
    render(<NoCommunitiesEmpty />);
    expect(screen.queryByText("Check again")).toBeNull();
  });
});

describe("StrandedBanner", () => {
  it("explains the stale invite instead of hiding it in a tooltip", () => {
    render(<StrandedBanner />);
    expect(
      screen.getByText(/rotated its keys past the epoch you hold/),
    ).toBeTruthy();
    // And says the history is still readable, because it is — the banner sits
    // above the pane rather than replacing it.
    expect(screen.getByText(/History from before the rotation/)).toBeTruthy();
  });

  it("points at Armada, where invites are actually made", () => {
    render(<StrandedBanner />);
    expect(
      screen.getByText("Open Armada").closest("a")?.getAttribute("href"),
    ).toBe(ARMADA_URL);
  });
});
