// @vitest-environment jsdom
/**
 * Emoji-only chat messages.
 *
 * `ChatMessageBody` is the body `ChatViewer` renders for every protocol, so
 * this is the chat window's behaviour, not a stand-in for it. Detection itself
 * is `src/lib/emoji-only.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatMessageBody } from "./ChatMessageBody";
import { settingsManager } from "@/services/settings";
import type { NostrEvent } from "@/types/nostr";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BLOB = "https://emoji.example/blob.png";

function message(content: string, tags: string[][] = []): NostrEvent {
  return {
    id: "0".repeat(64),
    pubkey: "1".repeat(64),
    created_at: 1,
    kind: 9,
    sig: "2".repeat(128),
    content,
    tags,
  };
}

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
  settingsManager.reset();
});

function render(event: NostrEvent, withReply = false) {
  act(() => {
    root.render(
      <ChatMessageBody
        event={event}
        replyPreview={
          withReply && <div data-testid="reply">replying to 😀</div>
        }
      />,
    );
  });
  return container.firstElementChild as HTMLElement;
}

const enlarged = () =>
  [...container.querySelectorAll<HTMLElement>("[data-emoji-only]")].map(
    (el) => el.dataset.emojiOnly,
  );

describe("an emoji-only chat message, with nothing stored", () => {
  it("renders a lone native emoji at the single tier", () => {
    const body = render(message("🔥"));
    expect(enlarged()).toEqual(["single"]);
    expect(body.className).toContain("text-5xl");
    expect(body.className).not.toContain("text-sm");
  });

  it("renders a lone custom emoji at the single tier, with its alt text", () => {
    render(message(":blob:", [["emoji", "blob", BLOB]]));
    expect(enlarged()).toEqual(["single"]);
    const img = container.querySelector("img")!;
    expect(img.className).toContain("size-12");
    expect(img.alt).toBe(":blob:");
  });

  it("renders mixed custom and native at the multi tier", () => {
    render(message("🎉 :blob: 🇸🇪 👨‍👩‍👧‍👦", [["emoji", "blob", BLOB]]));
    expect(enlarged()).toEqual(["multi"]);
    expect(container.querySelector("img")!.className).toContain("size-8");
  });

  it("keeps wrapping inside the message column", () => {
    const body = render(message("😀".repeat(10)));
    expect(enlarged()).toEqual(["multi"]);
    expect(body.className).toContain("break-words");
    expect(body.className).toContain("whitespace-pre-wrap");
  });
});

describe("chat messages that stay at normal size", () => {
  it.each([
    ["eleven emoji", "😀".repeat(11)],
    ["text and emoji", "lol 😂"],
    ["a link", "😀 https://example.com"],
    ["an inline code span", "`😀`"],
    ["a code fence", "```\n😀\n```"],
    ["a quote marker", "> 😀"],
    ["an unknown shortcode", ":nope:"],
    ["digits", "123"],
  ])("%s", (_name, content) => {
    const body = render(message(content));
    expect(enlarged()).toEqual([]);
    expect(body.className).toContain("text-sm leading-tight");
  });

  it("a custom emoji whose image does not load", () => {
    render(message(":gone:", [["emoji", "gone", "https://emoji.example/x"]]));
    expect(enlarged()).toEqual(["single"]);
    act(() => {
      container.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(enlarged()).toEqual([]);
    expect(container.textContent).toBe(":gone:");
  });
});

describe("a reply", () => {
  it("enlarges the body and leaves the quote above it at its own size", () => {
    const body = render(message("👍"), true);
    const reply = container.querySelector("[data-testid=reply]")!;
    expect(reply.closest("[data-emoji-only]")).toBeNull();
    expect(body.className).toContain("text-sm");
    expect(enlarged()).toEqual(["single"]);
    // The quote comes first, the enlarged body after it.
    expect(body.firstElementChild).toBe(reply);
  });

  it("is not made emoji-only by the emoji in its quote", () => {
    render(message("thanks"), true);
    expect(enlarged()).toEqual([]);
  });
});

describe("the Big emoji setting", () => {
  it("off returns the message to normal size, live", () => {
    const body = render(message("🔥 :blob:", [["emoji", "blob", BLOB]]));
    expect(enlarged()).toEqual(["multi"]);

    act(() => settingsManager.updateSetting("appearance", "bigEmoji", false));
    expect(enlarged()).toEqual([]);
    expect(body.className).toContain("text-sm leading-tight");
    expect(container.querySelector("img")!.className).toContain("size-5");

    act(() => settingsManager.updateSetting("appearance", "bigEmoji", true));
    expect(enlarged()).toEqual(["multi"]);
  });

  it("off leaves a reply's body at normal size too", () => {
    settingsManager.updateSetting("appearance", "bigEmoji", false);
    render(message("👍"), true);
    expect(enlarged()).toEqual([]);
  });
});
