import { describe, expect, it } from "vitest";

import {
  buildBrowserGroupUpdate,
  buildConcordDmUpdate,
  buildConcordWindowUpdate,
} from "./window-props";

const COMMUNITY = "a".repeat(64);
const PEER = "e".repeat(64);
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

  it("survives a window with no props at all", () => {
    expect(buildConcordWindowUpdate(undefined, COMMUNITY).props).toEqual({
      communityId: COMMUNITY,
    });
  });

  it("drops an open private conversation, since a DM replaces a channel", () => {
    // One selection, two families. A window carrying both reloads showing the
    // conversation while the sidebar highlights a channel.
    const update = buildConcordWindowUpdate(
      { communityId: COMMUNITY, dmPeer: PEER },
      COMMUNITY,
      CHANNEL,
    );
    expect("dmPeer" in update.props).toBe(false);
  });
});

describe("buildConcordDmUpdate", () => {
  it("replaces the channel rather than joining it", () => {
    const update = buildConcordDmUpdate(
      { communityId: COMMUNITY, channelId: CHANNEL },
      PEER,
    );
    expect(update.props).toEqual({ communityId: COMMUNITY, dmPeer: PEER });
  });

  it("keeps the community, so closing the DM comes back to it", () => {
    expect(
      buildConcordDmUpdate({ communityId: COMMUNITY }, PEER).props,
    ).toEqual({ communityId: COMMUNITY, dmPeer: PEER });
  });

  it("survives a window that never resolved a community", () => {
    const update = buildConcordDmUpdate(undefined, PEER);
    expect(update.props).toEqual({ dmPeer: PEER });
    expect(update.commandString).toBe("chat");
  });
});

describe("buildBrowserGroupUpdate", () => {
  const RELAY = "wss://relay.example.com/";

  it("writes both halves of the address", () => {
    // A group id is only unique within its relay, so a window that remembered
    // the id alone would reopen on whichever relay answered first.
    const update = buildBrowserGroupUpdate(undefined, "bitcoin", RELAY);
    expect(update.props).toEqual({ groupId: "bitcoin", groupRelay: RELAY });
  });

  it("replaces a channel and a conversation rather than joining them", () => {
    const update = buildBrowserGroupUpdate(
      { communityId: COMMUNITY, channelId: CHANNEL, dmPeer: PEER },
      "bitcoin",
      RELAY,
    );
    expect(update.props).toEqual({
      communityId: COMMUNITY,
      groupId: "bitcoin",
      groupRelay: RELAY,
    });
  });
});

describe("the command a browser window reopens with", () => {
  const RELAY = "wss://relay.example.com/";

  // `chat` dispatches on props: `chat <identifier>` is a SINGLE-conversation
  // window. A browser window that rebuilt its command with an argument would
  // reopen as one pane with no sidebar, losing every other section.
  it("stays bare chat, whatever is selected", () => {
    expect(buildConcordWindowUpdate({}, COMMUNITY, CHANNEL).commandString).toBe(
      "chat",
    );
    expect(
      buildConcordDmUpdate({ communityId: COMMUNITY }, PEER).commandString,
    ).toBe("chat");
    expect(buildBrowserGroupUpdate({}, "bitcoin", RELAY).commandString).toBe(
      "chat",
    );
  });

  it("drops a stale group when a channel is picked", () => {
    const update = buildConcordWindowUpdate(
      { groupId: "bitcoin", groupRelay: RELAY },
      COMMUNITY,
      CHANNEL,
    );
    expect(update.props).toEqual({
      communityId: COMMUNITY,
      channelId: CHANNEL,
    });
  });
});
