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
  it("rebuilds a chat browser on a community as bare chat", () => {
    // `chat <identifier>` is a single-conversation window; the browser's
    // selection rides in its props, never in the command.
    expect(
      reconstructCommand(
        win("chat", {
          identifier: { type: "browser" },
          communityId: COMMUNITY,
          channelId: "c".repeat(64),
        }),
      ),
    ).toBe("chat");
  });

  it("names a saved window of a removed app by its own app id, not a replacement", () => {
    // `concord` was removed; a window saved by it must not be rebuilt as some
    // other command that would then run as if the user had typed it.
    expect(reconstructCommand(win("concord", { communityId: COMMUNITY }))).toBe(
      "concord",
    );
    expect(reconstructCommand(win("ai", { prompt: "hi" }))).toBe("ai");
    expect(reconstructCommand(win("agent", { agent: "a".repeat(64) }))).toBe(
      "agent",
    );
  });

  it("still falls through to the app id for a window it knows nothing about", () => {
    expect(reconstructCommand(win("spells", { anything: 1 }))).toBe("spells");
  });
});
