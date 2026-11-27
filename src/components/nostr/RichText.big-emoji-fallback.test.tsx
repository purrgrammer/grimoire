// @vitest-environment jsdom
/**
 * A custom emoji whose image does not load.
 *
 * Needs a DOM: the fallback only exists after the `<img>` fires `error`, which
 * a static render never does.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RichText } from "./RichText";
import type { NostrEvent } from "@/types/nostr";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const event: NostrEvent = {
  id: "0".repeat(64),
  pubkey: "1".repeat(64),
  created_at: 1,
  kind: 1,
  sig: "2".repeat(128),
  content: ":gone: 😀",
  tags: [["emoji", "gone", "https://emoji.example/missing.png"]],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(bigEmoji: boolean) {
  act(() => {
    root.render(
      <RichText event={event} className="text-sm" options={{ bigEmoji }} />,
    );
  });
  return container.firstElementChild as HTMLElement;
}

function failImage() {
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  act(() => {
    img!.dispatchEvent(new Event("error"));
  });
}

describe("a custom emoji image that fails to load", () => {
  it("falls back to its shortcode and returns the body to normal size", () => {
    const body = render(true);
    expect(body.dataset.emojiOnly).toBe("multi");
    expect(body.className).toContain("text-3xl");
    expect(container.querySelector("img")?.alt).toBe(":gone:");

    failImage();

    expect(container.querySelector("img")).toBeNull();
    expect(body.textContent).toBe(":gone: 😀");
    expect(body.dataset.emojiOnly).toBeUndefined();
    expect(body.className).toContain("text-sm");
    expect(body.className).not.toContain("text-3xl");
  });

  it("falls back the same way where nothing is enlarged", () => {
    const body = render(false);
    failImage();
    expect(body.textContent).toBe(":gone: 😀");
    expect(body.querySelector("span[title=':gone:']")).not.toBeNull();
  });
});
