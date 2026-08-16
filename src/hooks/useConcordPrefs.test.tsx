// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useConcordPrefs } from "./useConcordPrefs";
import {
  CHAT_PREFS_STORAGE_KEY,
  resetConcordPrefs,
} from "@/services/concord-prefs";

const COMMUNITY = "a".repeat(64);
const CHANNEL = "c".repeat(64);

beforeEach(() => {
  localStorage.removeItem(CHAT_PREFS_STORAGE_KEY);
  resetConcordPrefs();
});

describe("useConcordPrefs", () => {
  it("answers from the store on the first render, with no loading state", () => {
    // The BehaviorSubject already holds a value, so `use$` has it synchronously
    // — this is why the open channel can be resolved DURING a render.
    const { result } = renderHook(() => useConcordPrefs());
    expect(result.current.isPinned(COMMUNITY, CHANNEL)).toBe(false);
    expect(result.current.lastChannel(COMMUNITY)).toBeUndefined();
  });

  it("repaints when a pin is toggled through it", () => {
    const { result } = renderHook(() => useConcordPrefs());
    act(() => result.current.togglePin(COMMUNITY, CHANNEL));
    expect(result.current.isPinned(COMMUNITY, CHANNEL)).toBe(true);
    act(() => result.current.togglePin(COMMUNITY, CHANNEL));
    expect(result.current.isPinned(COMMUNITY, CHANNEL)).toBe(false);
  });

  it("repaints a second sidebar when the first one folds a category", () => {
    // Two mounted hooks share one manager: the arrangement is the device's, not
    // the window's, so two Concord windows must not disagree about it.
    const first = renderHook(() => useConcordPrefs());
    const second = renderHook(() => useConcordPrefs());
    act(() => first.result.current.toggleCollapsed(COMMUNITY, "voice"));
    expect(second.result.current.isCollapsed(COMMUNITY, "voice")).toBe(true);
  });

  it("remembers the last channel and survives a remount", () => {
    const { result, unmount } = renderHook(() => useConcordPrefs());
    act(() => result.current.setLastChannel(COMMUNITY, CHANNEL));
    unmount();
    const again = renderHook(() => useConcordPrefs());
    expect(again.result.current.lastChannel(COMMUNITY)).toBe(CHANNEL);
  });

  it("empties when the account signs out under it", () => {
    const { result } = renderHook(() => useConcordPrefs());
    act(() => result.current.togglePin(COMMUNITY, CHANNEL));
    // The sidebar is still mounted at logout, so the reset has to reach it
    // rather than only the stored blob.
    act(() => resetConcordPrefs());
    expect(result.current.isPinned(COMMUNITY, CHANNEL)).toBe(false);
  });
});
