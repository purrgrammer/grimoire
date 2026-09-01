import { describe, it, expect } from "vitest";
import type { NostrEvent } from "nostr-tools";
import {
  buildPaymentUri,
  getPaymentDisplayAddress,
  isWebPaymentTarget,
  getPaymentLabel,
  getPaytoTargets,
  mergeProfilePayments,
  PAYMENT_TYPES,
} from "./payto";

function event(tags: string[][]): NostrEvent {
  return {
    id: "0".repeat(64),
    pubkey: "a".repeat(64),
    created_at: 0,
    kind: 10133,
    tags,
    content: "",
    sig: "b".repeat(128),
  };
}

describe("getPaytoTargets", () => {
  it("reads well-formed payto tags in order", () => {
    const targets = getPaytoTargets(
      event([
        ["payto", "bitcoin", "bc1qxq66e0t8d7ugdecwnmv58e90tpry23nc84pg9k"],
        ["payto", "nano", "nano_1dctqbmqxfppo9pswbm6kg9d4s4mbraqn8i4m7ob9gnz"],
      ]),
    );

    expect(targets).toEqual([
      {
        type: "bitcoin",
        address: "bc1qxq66e0t8d7ugdecwnmv58e90tpry23nc84pg9k",
      },
      {
        type: "nano",
        address: "nano_1dctqbmqxfppo9pswbm6kg9d4s4mbraqn8i4m7ob9gnz",
      },
    ]);
  });

  it("keeps unknown types — the spec's own example has one", () => {
    const targets = getPaytoTargets(
      event([["payto", "unknowntype", "l7tbta5b9xze6ckkfc99uohzxd009b0r"]]),
    );

    expect(targets).toEqual([
      { type: "unknowntype", address: "l7tbta5b9xze6ckkfc99uohzxd009b0r" },
    ]);
  });

  it("ignores non-payto tags and malformed payto tags", () => {
    const targets = getPaytoTargets(
      event([
        ["p", "c".repeat(64)],
        ["payto"],
        ["payto", "bitcoin"],
        ["payto", "", "addr"],
        ["payto", "bitcoin", ""],
        ["payto", "bitcoin", "   "],
        ["payto", "bitcoin", "bc1valid"],
      ]),
    );

    expect(targets).toEqual([{ type: "bitcoin", address: "bc1valid" }]);
  });

  it("normalizes case and whitespace on the type", () => {
    const targets = getPaytoTargets(
      event([["payto", " BitCoin ", " bc1valid "]]),
    );

    expect(targets).toEqual([{ type: "bitcoin", address: "bc1valid" }]);
  });
});

describe("buildPaymentUri", () => {
  it("uses the network's own scheme", () => {
    expect(buildPaymentUri({ type: "bitcoin", address: "bc1valid" })).toBe(
      "bitcoin:bc1valid",
    );
    expect(buildPaymentUri({ type: "monero", address: "48abc" })).toBe(
      "monero:48abc",
    );
  });

  it("routes BIP-352 and BIP-353 through the bitcoin scheme", () => {
    expect(buildPaymentUri({ type: "bip352", address: "sp1qq" })).toBe(
      "bitcoin:sp1qq",
    );
    expect(
      buildPaymentUri({ type: "bip353", address: "alice@example.com" }),
    ).toBe("bitcoin:alice@example.com");
  });

  it("strips the BIP-353 display prefix before building the URI", () => {
    // "the ₿ is not included in the DNS label which is resolved" — BIP 353.
    expect(
      buildPaymentUri({ type: "bip353", address: "₿alice@example.com" }),
    ).toBe("bitcoin:alice@example.com");
  });

  it("builds https handles for web payment services", () => {
    expect(buildPaymentUri({ type: "cashme", address: "alice" })).toBe(
      "https://cash.app/$alice",
    );
    expect(buildPaymentUri({ type: "paypal", address: "alice" })).toBe(
      "https://paypal.me/alice",
    );
  });

  it("links a geyser project to its page", () => {
    expect(buildPaymentUri({ type: "geyser", address: "grimoire" })).toBe(
      "https://geyser.fund/project/grimoire",
    );
    expect(buildPaymentUri({ type: "geyser", address: "a/../b" })).toBe(
      "https://geyser.fund/project/a%2F..%2Fb",
    );
  });

  it("gives lightning no URI — its address is not a lightning: payload", () => {
    expect(
      buildPaymentUri({ type: "lightning", address: "alice@example.com" }),
    ).toBeUndefined();
  });

  it("gives unknown types no URI — there is no payto:// fallback", () => {
    expect(
      buildPaymentUri({ type: "unknowntype", address: "l7tbta5b9xze" }),
    ).toBeUndefined();
  });

  it("never puts a tag-supplied type in scheme position", () => {
    expect(
      buildPaymentUri({ type: "javascript", address: "alert(1)" }),
    ).toBeUndefined();
    expect(
      buildPaymentUri({ type: "data", address: "text/html,<script>" }),
    ).toBeUndefined();
  });

  it("leaves address-safe characters alone", () => {
    expect(
      buildPaymentUri({ type: "bitcoin", address: "bc1q_a.b~c+d-e@f" }),
    ).toBe("bitcoin:bc1q_a.b~c+d-e@f");
  });

  it("percent-encodes an address that would otherwise escape the href", () => {
    expect(
      buildPaymentUri({ type: "bitcoin", address: "bc1valid?amount=1#x" }),
    ).toBe("bitcoin:bc1valid%3Famount%3D1%23x");
    expect(buildPaymentUri({ type: "bitcoin", address: "bc1 valid/x" })).toBe(
      "bitcoin:bc1%20valid%2Fx",
    );
    expect(
      buildPaymentUri({ type: "cashme", address: "alice/../../evil" }),
    ).toBe("https://cash.app/$alice%2F..%2F..%2Fevil");
  });
});

describe("registry invariants", () => {
  it("keys are lowercase, so a normalized type always matches", () => {
    for (const key of Object.keys(PAYMENT_TYPES)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it("every entry renders as either a glyph or an icon", () => {
    for (const [key, entry] of Object.entries(PAYMENT_TYPES)) {
      expect(
        Boolean(entry.symbol) || Boolean(entry.icon),
        `${key} has neither symbol nor icon`,
      ).toBe(true);
    }
  });

  it("no entry declares both a scheme and a url builder", () => {
    for (const [key, entry] of Object.entries(PAYMENT_TYPES)) {
      expect(
        Boolean(entry.scheme) && Boolean(entry.url),
        `${key} declares both scheme and url`,
      ).toBe(false);
    }
  });

  it("falls back to the raw type as a label", () => {
    expect(getPaymentLabel("bitcoin")).toBe("Bitcoin");
    expect(getPaymentLabel("unknowntype")).toBe("unknowntype");
  });
});

describe("mergeProfilePayments", () => {
  const monero = { type: "monero", address: "48abc" };

  it("puts the profile's lightning address first and the LNURL last", () => {
    expect(
      mergeProfilePayments([monero], {
        lud16: "alice@example.com",
        lud06: "LNURL1ABC",
      }),
    ).toEqual([
      { type: "lightning", address: "alice@example.com" },
      monero,
      { type: "lnurl", address: "LNURL1ABC" },
    ]);
  });

  it("shows a lightning address once when it is also a payto target", () => {
    const target = { type: "lightning", address: "alice@example.com" };

    expect(
      mergeProfilePayments([target, monero], { lud16: "Alice@Example.com" }),
    ).toEqual([target, monero]);
  });

  it("is a no-op for a profile with neither field", () => {
    expect(mergeProfilePayments([monero], {})).toEqual([monero]);
    expect(mergeProfilePayments([monero], undefined)).toEqual([monero]);
    expect(mergeProfilePayments([], undefined)).toEqual([]);
  });

  it("ignores blank profile fields", () => {
    expect(mergeProfilePayments([], { lud16: "   ", lud06: "" })).toEqual([]);
  });
});

describe("display and link behaviour", () => {
  it("shows a BIP-353 name with its ₿, adding it when the tag omits it", () => {
    expect(
      getPaymentDisplayAddress({
        type: "bip353",
        address: "alice@example.com",
      }),
    ).toBe("₿alice@example.com");
    expect(
      getPaymentDisplayAddress({
        type: "bip353",
        address: "₿alice@example.com",
      }),
    ).toBe("₿alice@example.com");
  });

  it("leaves every other address exactly as published", () => {
    expect(
      getPaymentDisplayAddress({ type: "bitcoin", address: "bc1valid" }),
    ).toBe("bc1valid");
    expect(
      getPaymentDisplayAddress({ type: "unknowntype", address: "l7tbta" }),
    ).toBe("l7tbta");
  });

  it("marks the handle services as web targets and nothing else", () => {
    for (const type of ["geyser", "cashme", "revolut", "venmo", "paypal"]) {
      expect(isWebPaymentTarget({ type, address: "alice" })).toBe(true);
    }
    for (const type of ["bitcoin", "monero", "lightning", "unknowntype"]) {
      expect(isWebPaymentTarget({ type, address: "x" })).toBe(false);
    }
  });
});
