/**
 * A picked date is a date in the READER's calendar. Everything here is about
 * not quietly turning it into someone else's.
 */

import { describe, expect, it } from "vitest";

import { fromDateInput, toDateInput } from "./jump-date";

describe("fromDateInput", () => {
  it("resolves to local midnight, not UTC midnight", () => {
    const ts = fromDateInput("2025-03-14");
    expect(ts).toBeDefined();
    const asDate = new Date(ts! * 1000);
    expect(asDate.getFullYear()).toBe(2025);
    expect(asDate.getMonth()).toBe(2);
    expect(asDate.getDate()).toBe(14);
    expect(asDate.getHours()).toBe(0);
  });

  it("refuses a date that does not exist", () => {
    // `new Date(2025, 1, 31)` is the 3rd of March, which would jump a reader to
    // a day they did not ask for rather than telling them the field is wrong.
    expect(fromDateInput("2025-02-31")).toBe(undefined);
  });

  it("refuses an empty or half-typed field", () => {
    expect(fromDateInput("")).toBe(undefined);
    expect(fromDateInput("2025-03")).toBe(undefined);
    expect(fromDateInput("not a date")).toBe(undefined);
  });

  it("accepts a leap day in a leap year and refuses it otherwise", () => {
    expect(fromDateInput("2024-02-29")).toBeDefined();
    expect(fromDateInput("2025-02-29")).toBe(undefined);
  });
});

describe("toDateInput", () => {
  it("spells a local date the way the input wants it", () => {
    expect(toDateInput(new Date(2025, 0, 5))).toBe("2025-01-05");
  });

  it("round-trips through the parser", () => {
    const date = new Date(2025, 10, 30);
    expect(fromDateInput(toDateInput(date))).toBe(
      Math.floor(date.getTime() / 1000),
    );
  });

  it("does not slide a late-evening date into tomorrow", () => {
    // What `toISOString().slice(0, 10)` does for anyone east of Greenwich, and
    // the reason this formats from the local getters instead.
    const lateLocal = new Date(2025, 5, 9, 23, 30);
    expect(toDateInput(lateLocal)).toBe("2025-06-09");
  });
});
