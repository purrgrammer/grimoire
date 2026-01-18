import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";

describe("NIP-19 Decoding for Grimoire Members", () => {
  it("should decode npub for _ username", () => {
    const npub =
      "npub1eras6w483zu6ee8kewfdm97n72fdkfd4e8ujgch0d3jfycfflwhsytskz0";
    const decoded = nip19.decode(npub);

    expect(decoded.type).toBe("npub");
    expect(decoded.data).toBe(
      "ce3cd5ba3ae52cec4e4b267fb29f1d2a526a5f4b8e8475d8a603a63c8925295f",
    );
  });

  it("should decode nprofile for verbiricha username", () => {
    const nprofile =
      "nprofile1qy28wumn8ghj7mrfva58gmnfdenjuun9vshszxnhwden5te0wpuhyctdd9jzuenfv96x5ctx9e3k7mf0qydhwumn8ghj7argv4nx7un9wd6zumn0wd68yvfwvdhk6tcpz9mhxue69uhkummnw3ezuamfdejj7qpq07jk7htfv243u0x5ynn43scq9wrxtaasmrwwa8lfu2ydwag6cx2qsan62z";
    const decoded = nip19.decode(nprofile);

    expect(decoded.type).toBe("nprofile");
    if (decoded.type === "nprofile") {
      expect(decoded.data.pubkey).toBe(
        "7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194",
      );
    }
  });
});
