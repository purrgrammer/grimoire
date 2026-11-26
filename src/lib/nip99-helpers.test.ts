import { describe, expect, it } from "vitest";
import {
  formatClassifiedPrice,
  formatClassifiedPriceShort,
  isClassifiedKind,
  parseClassified,
  parsePriceTag,
  safeHttpUrl,
} from "./nip99-helpers";
import {
  bikeListing,
  classified,
  roomRental,
} from "@/test/classified-fixtures";

describe("parseClassified", () => {
  it("reads every NIP-99 metadata tag of a complete listing", () => {
    const c = parseClassified(bikeListing());
    expect(c).toMatchObject({
      isDraft: false,
      identifier: "vintage-road-bike",
      title: "Vintage steel road bike, 56cm",
      summary: "Reynolds 531 frame, new tyres, collection only",
      publishedAt: 1763000000,
      location: "Lisbon, Portugal",
      geohash: "eycs0p",
      price: { raw: "450", amount: 450, currency: "EUR", decimals: 0 },
      status: { type: "active" },
    });
    // `t` tags de-duplicate case-insensitively, keeping the first spelling.
    expect(c.categories).toEqual(["bikes", "cycling"]);
    expect(c.images).toEqual([
      { url: "https://example.com/bike-1.jpg", width: 1200, height: 800 },
      { url: "https://example.com/bike-2.jpg" },
    ]);
  });

  it("marks kind 30403 as a draft without inventing a status", () => {
    const c = parseClassified(classified([["d", "x"]], { kind: 30403 }));
    expect(c.isDraft).toBe(true);
    expect(c.status).toBeUndefined();
  });

  it("claims no status when the tag is absent", () => {
    expect(parseClassified(roomRental()).status).toBeUndefined();
  });

  it("keeps a non-standard status verbatim and normalises the two standard ones", () => {
    expect(parseClassified(classified([["status", "SOLD"]])).status).toEqual({
      type: "sold",
    });
    expect(
      parseClassified(classified([["status", "reserved"]])).status,
    ).toEqual({ type: "other", value: "reserved" });
  });

  it("survives an event with no tags at all", () => {
    const c = parseClassified(classified([]));
    expect(c).toMatchObject({
      identifier: "",
      title: undefined,
      price: undefined,
      categories: [],
      images: [],
    });
  });

  it("skips empty and non-string values and keeps the first usable one", () => {
    const c = parseClassified(
      classified([
        ["title"],
        ["title", "   "],
        ["title", "Second title wins"],
        ["title", "Third"],
        ["t", ""],
        ["location", 42 as unknown as string],
      ]),
    );
    expect(c.title).toBe("Second title wins");
    expect(c.categories).toEqual([]);
    expect(c.location).toBeUndefined();
  });

  it("rejects published_at values that are not unix seconds", () => {
    for (const value of ["", "abc", "-5", "0", "1.5", "1763000000000"]) {
      expect(
        parseClassified(classified([["published_at", value]])).publishedAt,
      ).toBeUndefined();
    }
  });

  it("drops image URLs that are not absolute http(s)", () => {
    const c = parseClassified(
      classified([
        ["image", "javascript:alert(1)"],
        ["image", "data:image/png;base64,AAAA"],
        ["image", "/relative.png"],
        ["image", "not a url"],
        ["image"],
        ["image", "https://example.com/a.png", "huge"],
        ["image", "https://example.com/a.png"],
      ]),
    );
    expect(c.images).toEqual([{ url: "https://example.com/a.png" }]);
  });

  it("prefers the first numeric price but keeps a malformed one rather than nothing", () => {
    expect(
      parseClassified(
        classified([
          ["price", "ask me", "USD"],
          ["price", "20", "USD"],
        ]),
      ).price?.amount,
    ).toBe(20);
    expect(
      parseClassified(classified([["price", "ask me", "USD"]])).price,
    ).toMatchObject({ raw: "ask me", amount: undefined, currency: "USD" });
    expect(parseClassified(classified([["price"]])).price).toBeUndefined();
  });
});

describe("parsePriceTag", () => {
  it("reads the spec's three examples", () => {
    expect(parsePriceTag(["price", "50", "USD"])).toMatchObject({
      amount: 50,
      currency: "USD",
      frequency: undefined,
    });
    expect(parsePriceTag(["price", "15", "EUR", "month"])).toMatchObject({
      amount: 15,
      frequency: "month",
    });
    expect(parsePriceTag(["price", "50000", "GBP", "year"])).toMatchObject({
      amount: 50000,
    });
  });

  it("refuses amounts JavaScript would happily coerce", () => {
    for (const raw of ["1e3", "0x10", "-5", "Infinity", "1,000"]) {
      expect(parsePriceTag(["price", raw, "USD"])?.amount).toBeUndefined();
    }
  });
});

describe("formatClassifiedPrice", () => {
  const fmt = (tag: string[], locale = "en-US") =>
    formatClassifiedPrice(parsePriceTag(tag)!, locale);

  it("formats ISO currencies in the reader's locale, keeping the listing's precision", () => {
    expect(fmt(["price", "50", "USD"])).toBe("$50");
    expect(fmt(["price", "50000", "GBP"])).toBe("£50,000");
    expect(fmt(["price", "19.90", "EUR"], "de-DE")).toBe("19,90\u00a0€");
  });

  it("does not round a small crypto amount away", () => {
    expect(fmt(["price", "0.0005", "btc"])).toBe("BTC\u00a00.0005");
  });

  it("shows sats and non-ISO codes as a number and the code as written", () => {
    expect(fmt(["price", "21000", "sats"])).toBe("21,000 sats");
    expect(fmt(["price", "100", "USDT"])).toBe("100 USDT");
    expect(fmt(["price", "100"])).toBe("100");
  });

  it("shows a non-numeric amount exactly as written", () => {
    expect(fmt(["price", "best offer", "EUR"])).toBe("best offer EUR");
  });

  it("appends the frequency in the short form", () => {
    expect(
      formatClassifiedPriceShort(
        parsePriceTag(["price", "15", "EUR", "month"])!,
        "en-US",
      ),
    ).toBe("€15 / month");
  });
});

describe("helpers", () => {
  it("recognises both NIP-99 kinds and nothing else", () => {
    expect(isClassifiedKind(30402)).toBe(true);
    expect(isClassifiedKind(30403)).toBe(true);
    expect(isClassifiedKind(30023)).toBe(false);
  });

  it("safeHttpUrl accepts only http and https", () => {
    expect(safeHttpUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHttpUrl("ftp://a.example/x")).toBeUndefined();
    expect(safeHttpUrl(" JAVASCRIPT:alert(1)")).toBeUndefined();
  });
});
