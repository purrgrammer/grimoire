import { describe, expect, it } from "vitest";

import { proposeCommand } from "./ai-commands";

describe("proposeCommand", () => {
  it("recognises a real command, and carries what the palette shows", () => {
    expect(proposeCommand("nip 01")).toMatchObject({
      command: "nip 01",
      appId: "nip",
      name: "nip",
      args: "01",
    });
    // The description is the man page's first sentence, as in the palette.
    expect(proposeCommand("nip 01")?.description).toMatch(/\.$/);
  });

  it("ignores a command grimoire does not have", () => {
    expect(proposeCommand("rm -rf /")).toBeUndefined();
    expect(proposeCommand("sudo publish everything")).toBeUndefined();
  });

  it("ignores blank lines and comments", () => {
    expect(proposeCommand("   ")).toBeUndefined();
    expect(proposeCommand("# open a profile")).toBeUndefined();
  });

  it("refuses commands that act on the user's behalf", () => {
    // A model reading untrusted note text must not be able to cause a post.
    expect(proposeCommand("post hello world")?.refusal).toMatch(
      /only opens when you run it yourself/,
    );
    expect(proposeCommand("zap alice 1000")?.refusal).toBeTruthy();
    expect(proposeCommand("wallet")?.refusal).toBeTruthy();
  });

  it("does not refuse read-only commands", () => {
    expect(
      proposeCommand("relay wss://relay.example")?.refusal,
    ).toBeUndefined();
    expect(proposeCommand("kinds")?.refusal).toBeUndefined();
  });
});
