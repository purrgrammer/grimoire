// @vitest-environment jsdom
/**
 * The regression: a chat window whose box mounts LATE — after the loading and
 * "no conversation" early returns — never got measured, so the thread pane read
 * "not measured yet", drew its full column on a phone, and overlapped the
 * conversation it was meant to sit beside.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useMeasuredWidth } from "./useMeasuredWidth";

const observed = new Map<Element, (width: number) => void>();

beforeEach(() => {
  observed.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(node: Element) {
        observed.set(node, (width: number) =>
          this.cb(
            [{ target: node, contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          ),
        );
      }
      disconnect() {
        for (const node of [...observed.keys()]) observed.delete(node);
      }
    },
  );
});

function Late({ ready }: { ready: boolean }) {
  const [ref, width] = useMeasuredWidth();
  if (!ready) return <div>loading</div>;
  return (
    <div ref={ref} data-testid="box">
      {width === undefined ? "unmeasured" : String(width)}
    </div>
  );
}

function resize(width: number) {
  const box = screen.getByTestId("box");
  act(() => observed.get(box)?.(width));
}

describe("useMeasuredWidth", () => {
  it("measures a box that only mounts on a later render", () => {
    const { rerender } = render(<Late ready={false} />);
    rerender(<Late ready={true} />);
    expect(observed.size).toBe(1);
    resize(390);
    expect(screen.getByTestId("box").textContent).toBe("390");
  });

  it("keeps reporting as the element resizes", () => {
    render(<Late ready={true} />);
    resize(1200);
    expect(screen.getByTestId("box").textContent).toBe("1200");
    resize(360);
    expect(screen.getByTestId("box").textContent).toBe("360");
  });
});
