import { describe, expect, it } from "vitest";

import { buildConcordWindowUpdate } from "./window-props";

const COMMUNITY = "a".repeat(64);
const CHANNEL = "c".repeat(64);

describe("buildConcordWindowUpdate", () => {
  it("carries every prop the window already had", () => {
    // `Logic.updateWindow` replaces props wholesale, so anything this helper
    // forgets to spread is gone from the window for good. Asserted with a prop
    // that has nothing to do with navigation, which is exactly the kind a
    // hand-written call site drops.
    const update = buildConcordWindowUpdate(
      { dynamicTitle: "#general", somethingElse: 7 },
      COMMUNITY,
      CHANNEL,
    );
    expect(update.props).toEqual({
      dynamicTitle: "#general",
      somethingElse: 7,
      communityId: COMMUNITY,
      channelId: CHANNEL,
    });
  });

  it("upgrades a window opened on an id prefix to the resolved id", () => {
    // `concord 3fa2` is a legal command, so a window can start life holding
    // something that only resolves by prefix search.
    const update = buildConcordWindowUpdate(
      { communityId: "3fa2" },
      COMMUNITY,
      CHANNEL,
    );
    expect(update.props.communityId).toBe(COMMUNITY);
  });

  it("drops a channel from the community you just left", () => {
    const update = buildConcordWindowUpdate(
      { communityId: "b".repeat(64), channelId: CHANNEL },
      COMMUNITY,
    );
    expect(update.props).toEqual({ communityId: COMMUNITY });
    expect("channelId" in update.props).toBe(false);
  });

  it("names only the community in the command, since a channel has no address", () => {
    expect(
      buildConcordWindowUpdate(undefined, COMMUNITY, CHANNEL).commandString,
    ).toBe(`concord ${COMMUNITY}`);
  });

  it("survives a window with no props at all", () => {
    expect(buildConcordWindowUpdate(undefined, COMMUNITY).props).toEqual({
      communityId: COMMUNITY,
    });
  });
});
