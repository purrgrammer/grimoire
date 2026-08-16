import { describe, expect, it } from "vitest";

import { groupParticipants, isStaff } from "./participant-order";
import type { Participant } from "@/types/chat";

const p = (pubkey: string, role?: Participant["role"]): Participant => ({
  pubkey,
  ...(role ? { role } : {}),
});

describe("groupParticipants", () => {
  it("puts staff first, under their own heading", () => {
    const rows = groupParticipants([
      p("a"),
      p("b", "admin"),
      p("c", "member"),
      p("d", "moderator"),
    ]);
    expect(
      rows.map((r) => (r.type === "heading" ? r.label : r.participant.pubkey)),
    ).toEqual(["Staff", "b", "d", "Members", "a", "c"]);
  });

  it("ranks the staff words the protocols use", () => {
    const rows = groupParticipants([
      p("mod", "moderator"),
      p("op", "op"),
      p("host", "host"),
      p("admin", "admin"),
    ]);
    expect(
      rows
        .filter((r) => r.type === "participant")
        .map((r) => r.participant.pubkey),
    ).toEqual(["host", "admin", "op", "mod"]);
  });

  it("drops both headings when nobody is staff", () => {
    // One heading over the whole list says nothing the dropdown's own
    // "Members (n)" line does not already say.
    const rows = groupParticipants([p("a"), p("b", "member")]);
    expect(rows.every((r) => r.type === "participant")).toBe(true);
  });

  it("counts each section", () => {
    const rows = groupParticipants([p("a", "admin"), p("b"), p("c")]);
    expect(rows.filter((r) => r.type === "heading")).toEqual([
      { type: "heading", label: "Staff", count: 1 },
      { type: "heading", label: "Members", count: 2 },
    ]);
  });

  it("does not reorder the members below the staff", () => {
    // Adapters emit membership in their own order — join order, roster order —
    // and re-sorting it here would throw that away for no reader's benefit.
    const rows = groupParticipants([p("z"), p("a"), p("m", "admin")]);
    expect(
      rows
        .filter((r) => r.type === "participant")
        .map((r) => r.participant.pubkey),
    ).toEqual(["m", "z", "a"]);
  });

  it("leaves the caller's array alone", () => {
    const input = [p("a"), p("b", "admin")];
    groupParticipants(input);
    expect(input.map((x) => x.pubkey)).toEqual(["a", "b"]);
  });
});

describe("isStaff", () => {
  it("knows a plain member is not staff", () => {
    expect(isStaff("member")).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });
});
