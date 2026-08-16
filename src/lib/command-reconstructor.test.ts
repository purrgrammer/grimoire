import { describe, expect, it } from "vitest";

import { reconstructCommand } from "./command-reconstructor";
import type { WindowInstance } from "@/types/app";

const COMMUNITY = "3fa2".padEnd(64, "0");

const win = (appId: string, props: Record<string, unknown>): WindowInstance =>
  ({ id: "w1", appId, props }) as WindowInstance;

describe("reconstructCommand", () => {
  // The toolbar falls back to this whenever a window has no stored
  // `commandString` — copy-command and save-as-spell both go through it — so a
  // missing case is a spell that reopens on the wrong thing.
  it("names the community a Concord window is on", () => {
    expect(reconstructCommand(win("concord", { communityId: COMMUNITY }))).toBe(
      `concord ${COMMUNITY}`,
    );
  });

  it("leaves the channel out, because a channel has no address to type", () => {
    expect(
      reconstructCommand(
        win("concord", { communityId: COMMUNITY, channelId: "c".repeat(64) }),
      ),
    ).toBe(`concord ${COMMUNITY}`);
  });

  it("falls back to the bare command before a community is chosen", () => {
    expect(reconstructCommand(win("concord", {}))).toBe("concord");
  });

  it("still falls through to the app id for a window it knows nothing about", () => {
    expect(reconstructCommand(win("spells", { anything: 1 }))).toBe("spells");
  });
});
