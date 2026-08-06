// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import {
  useSuggestionRenderer,
  type SuggestionListHandle,
  type SuggestionListProps,
} from "./useSuggestionRenderer";
import type { SuggestionProps } from "@tiptap/suggestion";

// floating-ui requires layout APIs jsdom lacks
beforeAll(() => {
  const rect = {
    x: 0,
    y: 0,
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    toJSON: () => ({}),
  };
  HTMLElement.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = (() => []) as any;
  document.elementFromPoint = (() => null) as any;
});

// Minimal suggestion list component
const MockList = forwardRef<SuggestionListHandle, SuggestionListProps<string>>(
  ({ items }, ref) => {
    useImperativeHandle(ref, () => ({
      onKeyDown: () => false,
    }));
    return <div>{items.join(",")}</div>;
  },
);
MockList.displayName = "MockList";

/**
 * Build the minimal props shape Tiptap passes to onStart/onUpdate/onExit.
 * Cast because the real SuggestionProps also carries floating-ui positioning
 * fields (placement, offset, flip, floatingUi, ...) the hook never reads.
 */
function makeProps(items: string[]): SuggestionProps<string> {
  return {
    items,
    command: vi.fn(),
    clientRect: () => new DOMRect(),
    editor: {} as any,
    range: { from: 0, to: 0 },
    query: "",
    text: "",
    decorationNode: null,
    event: null,
  } as unknown as SuggestionProps<string>;
}

describe("useSuggestionRenderer", () => {
  it("renders portal when suggestion starts with items", () => {
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps(["alice", "bob"]));
    });

    expect(result.current.portal).not.toBeNull();
  });

  it("does not render portal when items array is empty", () => {
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps([]));
    });

    // Empty items → no popup (prevents "No profiles found" flash)
    expect(result.current.portal).toBeNull();
  });

  it("hides portal after onExit", () => {
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps(["alice"]));
    });
    expect(result.current.portal).not.toBeNull();

    act(() => {
      handlers.onExit!(makeProps([]));
    });
    expect(result.current.portal).toBeNull();
  });

  it("ignores stale onUpdate with items after onExit (async race condition)", () => {
    // Reproduce the bug:
    // 1. User types "@alice" → suggestion shows
    // 2. User selects a profile → onExit fires
    // 3. A stale async items() resolves and fires onUpdate → popup must NOT reopen
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps(["alice"]));
    });
    expect(result.current.portal).not.toBeNull();

    // User completes the suggestion
    act(() => {
      handlers.onExit!(makeProps([]));
    });
    expect(result.current.portal).toBeNull();

    // Stale async onUpdate arrives after exit
    act(() => {
      handlers.onUpdate!(makeProps(["bob"]));
    });

    // Portal must remain closed
    expect(result.current.portal).toBeNull();
  });

  it("ignores stale onUpdate with empty items after onExit", () => {
    // Reproduce: Tiptap fires onUpdate([]) before onExit when space is pressed
    // → "No profiles found" must NOT appear
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps(["alice"]));
    });

    act(() => {
      handlers.onExit!(makeProps([]));
    });

    // onUpdate with empty items fires (stale Tiptap cycle)
    act(() => {
      handlers.onUpdate!(makeProps([]));
    });

    expect(result.current.portal).toBeNull();
  });

  it("updates items while suggestion is active", () => {
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps(["alice"]));
    });
    expect(result.current.portal).not.toBeNull();

    // User keeps typing → items are refined
    act(() => {
      handlers.onUpdate!(makeProps(["alice-updated"]));
    });
    expect(result.current.portal).not.toBeNull();
  });

  it("hides portal when onUpdate delivers empty items during active session", () => {
    // When user's query genuinely yields no results, hide the popup
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    act(() => {
      handlers.onStart!(makeProps(["alice"]));
    });
    expect(result.current.portal).not.toBeNull();

    act(() => {
      handlers.onUpdate!(makeProps([]));
    });

    // No items → hide the popup (cleaner than showing "No results")
    expect(result.current.portal).toBeNull();
  });

  it("allows a new suggestion session after a previous one exits", () => {
    const { result } = renderHook(() => useSuggestionRenderer(MockList as any));
    const handlers = result.current.render();

    // First session
    act(() => {
      handlers.onStart!(makeProps(["alice"]));
    });
    act(() => {
      handlers.onExit!(makeProps([]));
    });
    expect(result.current.portal).toBeNull();

    // Second session — user types @ again
    const handlers2 = result.current.render();
    act(() => {
      handlers2.onStart!(makeProps(["bob"]));
    });
    expect(result.current.portal).not.toBeNull();
  });
});
