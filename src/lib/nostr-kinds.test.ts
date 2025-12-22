import { describe, expect, it } from "vitest";
import {
  isRegularKind,
  isReplaceableKind,
  isEphemeralKind,
  isParameterizedReplaceableKind,
  isAddressableKind,
  getKindCategory,
  REGULAR_START,
  REGULAR_END,
  REPLACEABLE_START,
  REPLACEABLE_END,
  EPHEMERAL_START,
  EPHEMERAL_END,
  PARAMETERIZED_REPLACEABLE_START,
  PARAMETERIZED_REPLACEABLE_END,
} from "./nostr-kinds";

describe("nostr-kinds constants", () => {
  it("should have correct NIP-01 boundaries", () => {
    expect(REGULAR_START).toBe(0);
    expect(REGULAR_END).toBe(10000);
    expect(REPLACEABLE_START).toBe(10000);
    expect(REPLACEABLE_END).toBe(20000);
    expect(EPHEMERAL_START).toBe(20000);
    expect(EPHEMERAL_END).toBe(30000);
    expect(PARAMETERIZED_REPLACEABLE_START).toBe(30000);
    expect(PARAMETERIZED_REPLACEABLE_END).toBe(40000);
  });
});

describe("isRegularKind (from nostr-tools)", () => {
  it("should return true for regular kinds", () => {
    expect(isRegularKind(1)).toBe(true); // Text note
    expect(isRegularKind(7)).toBe(true); // Reaction
    expect(isRegularKind(9999)).toBe(true);
  });

  it("should return false for special replaceable kinds 0 and 3", () => {
    // nostr-tools treats 0 (Metadata) and 3 (Contacts) as replaceable, not regular
    expect(isRegularKind(0)).toBe(false);
    expect(isRegularKind(3)).toBe(false);
  });

  it("should return false for non-regular kinds", () => {
    expect(isRegularKind(10000)).toBe(false);
    expect(isRegularKind(20000)).toBe(false);
    expect(isRegularKind(30000)).toBe(false);
  });
});

describe("isReplaceableKind (from nostr-tools)", () => {
  it("should return true for replaceable kinds (0, 3, 10000-19999)", () => {
    // nostr-tools includes 0 (Metadata) and 3 (Contacts) as replaceable
    expect(isReplaceableKind(0)).toBe(true); // Metadata
    expect(isReplaceableKind(3)).toBe(true); // Contacts
    expect(isReplaceableKind(10000)).toBe(true);
    expect(isReplaceableKind(10002)).toBe(true); // Relay list
    expect(isReplaceableKind(19999)).toBe(true);
  });

  it("should return false for non-replaceable kinds", () => {
    expect(isReplaceableKind(1)).toBe(false);
    expect(isReplaceableKind(7)).toBe(false);
    expect(isReplaceableKind(20000)).toBe(false);
    expect(isReplaceableKind(30000)).toBe(false);
  });
});

describe("isEphemeralKind (from nostr-tools)", () => {
  it("should return true for ephemeral kinds (20000-29999)", () => {
    expect(isEphemeralKind(20000)).toBe(true);
    expect(isEphemeralKind(22242)).toBe(true); // Auth
    expect(isEphemeralKind(29999)).toBe(true);
  });

  it("should return false for non-ephemeral kinds", () => {
    expect(isEphemeralKind(0)).toBe(false);
    expect(isEphemeralKind(10000)).toBe(false);
    expect(isEphemeralKind(19999)).toBe(false);
    expect(isEphemeralKind(30000)).toBe(false);
  });
});

describe("isParameterizedReplaceableKind", () => {
  it("should return true for parameterized replaceable kinds (30000-39999)", () => {
    expect(isParameterizedReplaceableKind(30000)).toBe(true);
    expect(isParameterizedReplaceableKind(30023)).toBe(true); // Long-form content
    expect(isParameterizedReplaceableKind(30311)).toBe(true); // Live activity
    expect(isParameterizedReplaceableKind(39999)).toBe(true);
  });

  it("should return false for non-parameterized replaceable kinds", () => {
    expect(isParameterizedReplaceableKind(0)).toBe(false);
    expect(isParameterizedReplaceableKind(1)).toBe(false);
    expect(isParameterizedReplaceableKind(10002)).toBe(false);
    expect(isParameterizedReplaceableKind(20000)).toBe(false);
    expect(isParameterizedReplaceableKind(40000)).toBe(false);
  });
});

describe("isAddressableKind", () => {
  it("should return true for special replaceable kinds 0 and 3", () => {
    expect(isAddressableKind(0)).toBe(true); // Metadata
    expect(isAddressableKind(3)).toBe(true); // Contacts
  });

  it("should return true for replaceable kinds (10000-19999)", () => {
    expect(isAddressableKind(10000)).toBe(true);
    expect(isAddressableKind(10002)).toBe(true);
    expect(isAddressableKind(19999)).toBe(true);
  });

  it("should return true for parameterized replaceable kinds", () => {
    expect(isAddressableKind(30000)).toBe(true);
    expect(isAddressableKind(30023)).toBe(true);
    expect(isAddressableKind(39999)).toBe(true);
  });

  it("should return false for regular kinds", () => {
    expect(isAddressableKind(1)).toBe(false);
    expect(isAddressableKind(7)).toBe(false);
    expect(isAddressableKind(9999)).toBe(false);
  });

  it("should return false for ephemeral kinds", () => {
    expect(isAddressableKind(20000)).toBe(false);
    expect(isAddressableKind(22242)).toBe(false);
    expect(isAddressableKind(29999)).toBe(false);
  });
});

describe("getKindCategory", () => {
  it("should categorize special replaceable kinds 0 and 3", () => {
    expect(getKindCategory(0)).toBe("replaceable");
    expect(getKindCategory(3)).toBe("replaceable");
  });

  it("should categorize regular kinds", () => {
    expect(getKindCategory(1)).toBe("regular");
    expect(getKindCategory(7)).toBe("regular");
    expect(getKindCategory(9999)).toBe("regular");
  });

  it("should categorize replaceable kinds", () => {
    expect(getKindCategory(10000)).toBe("replaceable");
    expect(getKindCategory(10002)).toBe("replaceable");
    expect(getKindCategory(19999)).toBe("replaceable");
  });

  it("should categorize ephemeral kinds", () => {
    expect(getKindCategory(20000)).toBe("ephemeral");
    expect(getKindCategory(22242)).toBe("ephemeral");
    expect(getKindCategory(29999)).toBe("ephemeral");
  });

  it("should categorize parameterized replaceable kinds", () => {
    expect(getKindCategory(30000)).toBe("parameterized_replaceable");
    expect(getKindCategory(30023)).toBe("parameterized_replaceable");
    expect(getKindCategory(39999)).toBe("parameterized_replaceable");
  });
});
