import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import {
  popOutUrl,
  eventPreviewWindow,
  profilePreviewWindow,
  runCommandWindow,
  standaloneWindowId,
} from "./standalone-window";

/**
 * The windows single-window routes bring into the workspace (#313). Their ids
 * are what keeps a route's window from being placed twice, and what carries an
 * id-keyed draft across the move.
 */
describe("standalone windows", () => {
  const pubkey = "a".repeat(64);
  const npub = nip19.npubEncode(pubkey);

  it("derives the id from the command, stable across reloads", () => {
    expect(standaloneWindowId("man kind")).toBe("pop-out:man kind");
    expect(standaloneWindowId("man kind")).toBe(standaloneWindowId("man kind"));
    expect(standaloneWindowId("man kind")).not.toBe(
      standaloneWindowId("man nips"),
    );
  });

  it("gives /run the window its command describes", () => {
    expect(
      runCommandWindow({
        appId: "man",
        props: { cmd: "kind" },
        commandString: "man kind",
        customTitle: "Kinds help",
      }),
    ).toEqual({
      id: "pop-out:man kind",
      appId: "man",
      props: { cmd: "kind" },
      commandString: "man kind",
      customTitle: "Kinds help",
    });
  });

  it("makes /<npub> the same window as /run?cmd=profile <npub>", () => {
    const preview = profilePreviewWindow(npub, pubkey);
    expect(preview).toEqual({
      id: `pop-out:profile ${npub}`,
      appId: "profile",
      props: { pubkey },
      commandString: `profile ${npub}`,
    });
  });

  it("makes /<nevent|naddr> the `open` window for that identifier", () => {
    const pointer = { id: "b".repeat(64), kind: 1, author: pubkey };
    const nevent = nip19.neventEncode(pointer);
    expect(eventPreviewWindow(nevent, pointer)).toEqual({
      id: `pop-out:open ${nevent}`,
      appId: "open",
      props: { pointer },
      commandString: `open ${nevent}`,
    });

    const address = { kind: 30023, pubkey, identifier: "post" };
    const naddr = nip19.naddrEncode(address);
    expect(eventPreviewWindow(naddr, address).id).toBe(`pop-out:open ${naddr}`);
  });

  it("pop-out URLs carry the command, round-trippable", () => {
    const command = `req -k 1 -t "a&b" wss://relay.example/?x=1`;
    const url = popOutUrl(command);
    expect(url.startsWith("/run?")).toBe(true);
    const params = new URL(url, "https://grimoire.test").searchParams;
    expect(params.get("cmd")).toBe(command);
    expect([...params.keys()]).toEqual(["cmd"]);
  });
});
