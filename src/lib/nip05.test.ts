import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";

describe("NIP-19 Decoding for Grimoire Members", () => {
  it("should decode nprofile for _ username", () => {
    const nprofile =
      "nprofile1qyg8wumn8ghj7mn0wd68ytnddakj7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uq3vamnwvaz7tmhda6zumn0wd68ytnsv9e8g7f0qyfhwumn8ghj7am0wsh82arcduhx7mn99uq35amnwvaz7tms09exzmtfvshxv6tpw34xze3wvdhk6tcpzamhxue69uhhyetvv9ujuurjd9kkzmpwdejhgtcppemhxue69uhkummn9ekx7mp0qqsv37cd82nc3wdvunmvhykajlfl9ykmyk6un7fyvthkceyjvy5lhtcpnnnuw";
    const decoded = nip19.decode(nprofile);

    expect(decoded.type).toBe("nprofile");
    if (decoded.type === "nprofile") {
      expect(decoded.data.pubkey).toBe(
        "c8fb0d3aa788b9ace4f6cb92dd97d3f292db25b5c9f92462ef6c64926129fbaf",
      );
    }
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
