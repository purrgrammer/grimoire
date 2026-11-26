// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { compactRenderers } from "./index";
import { ClassifiedCompactPreview } from "./ClassifiedCompactPreview";
import {
  bikeListing,
  classified,
  roomRental,
} from "@/test/classified-fixtures";

vi.mock("@/core/state", () => ({
  useGrimoire: () => ({ locale: { locale: "en-US" } }),
  useAddWindow: () => vi.fn(),
}));

afterEach(cleanup);

const LONG = "Extremely long listing title ".repeat(20).trim();

describe("ClassifiedCompactPreview", () => {
  it("is registered for both NIP-99 kinds", () => {
    expect(compactRenderers[30402]).toBe(ClassifiedCompactPreview);
    expect(compactRenderers[30403]).toBe(ClassifiedCompactPreview);
  });

  it("says title, price and location", () => {
    const { container } = render(
      <ClassifiedCompactPreview event={bikeListing()} />,
    );
    expect(container.textContent).toBe(
      "Vintage steel road bike, 56cm€450Lisbon, Portugal",
    );
  });

  it("shows the price frequency", () => {
    const { container } = render(
      <ClassifiedCompactPreview event={roomRental()} />,
    );
    expect(container.textContent).toContain("€15 / month");
  });

  it("labels a 30403 as a draft and a sold listing as sold", () => {
    const draft = render(
      <ClassifiedCompactPreview
        event={classified([["title", "Old sofa"]], { kind: 30403 })}
      />,
    );
    expect(draft.container.textContent).toBe("draftOld sofa");
    cleanup();
    const sold = render(
      <ClassifiedCompactPreview
        event={classified([
          ["title", "Old sofa"],
          ["status", "sold"],
          ["price", "10", "EUR"],
        ])}
      />,
    );
    expect(sold.container.textContent).toBe("soldOld sofa€10");
  });

  it("does not call an untagged or active listing anything", () => {
    const { container } = render(
      <ClassifiedCompactPreview
        event={classified([
          ["title", "Lamp"],
          ["status", "active"],
        ])}
      />,
    );
    expect(container.textContent).toBe("Lamp");
  });

  it("falls back to the summary, then to a placeholder", () => {
    const summary = render(
      <ClassifiedCompactPreview
        event={classified([["summary", "Only a summary"]])}
      />,
    );
    expect(summary.container.textContent).toBe("Only a summary");
    cleanup();
    const empty = render(<ClassifiedCompactPreview event={classified([])} />);
    expect(empty.container.textContent).toBe("Untitled listing");
  });

  it("stays on one line: no wrapping, every part can shrink or truncate", () => {
    const { container } = render(
      <ClassifiedCompactPreview
        event={classified([
          ["title", LONG],
          ["price", "123456789", "EUR", "fortnight"],
          ["location", LONG],
          ["status", LONG],
        ])}
      />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("whitespace-nowrap");
    expect(row.className).toContain("overflow-hidden");
    expect(row.className).not.toMatch(/flex-wrap|line-clamp-[2-9]/);
    for (const part of Array.from(row.children)) {
      expect(part.className).toContain("truncate");
      // Anything that refuses to shrink is capped to a share of the row.
      if (part.className.includes("shrink-0")) {
        expect(part.className).toMatch(/max-w-\[\d+%\]/);
      }
    }
    expect(row.querySelectorAll("br, p, div")).toHaveLength(0);
  });

  it("renders hostile tag values as text, never as markup", () => {
    const { container } = render(
      <ClassifiedCompactPreview
        event={classified([
          ["title", '<img src=x onerror="alert(1)">'],
          ["location", "<script>alert(1)</script>"],
        ])}
      />,
    );
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
