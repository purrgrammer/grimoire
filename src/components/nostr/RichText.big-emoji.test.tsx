/**
 * Where an emoji-only body is enlarged, and where it must not be.
 *
 * The detection itself is `src/lib/emoji-only.test.ts`. This is the wiring: the
 * `bigEmoji` option, the appearance setting, and the surfaces that never opt in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventStoreProvider } from "applesauce-react/providers";
import { RichText } from "./RichText";
import { DefaultCompactPreview } from "./compact";
import { DetailKindRenderer, KindRenderer } from "./kinds";
import eventStore from "@/services/event-store";
import { settingsManager } from "@/services/settings";
import type { NostrEvent } from "@/types/nostr";

vi.mock("@/core/state", () => ({
  useGrimoire: () => ({ locale: { locale: "en-US" }, state: {} }),
  useAddWindow: () => vi.fn(),
}));

const BLOB = "https://emoji.example/blob.png";

function note(content: string, tags: string[][] = []): NostrEvent {
  return {
    id: "0".repeat(64),
    pubkey: "1".repeat(64),
    created_at: 1,
    kind: 1,
    sig: "2".repeat(128),
    content,
    tags,
  };
}

function body(event: NostrEvent, bigEmoji = true) {
  return renderToStaticMarkup(
    <RichText event={event} className="text-sm" options={{ bigEmoji }} />,
  );
}

afterEach(() => {
  settingsManager.reset();
});

describe("an emoji-only body that opted in", () => {
  it("renders a lone emoji at the single tier, over the caller's size", () => {
    const html = body(note("😀"));
    expect(html).toContain('data-emoji-only="single"');
    expect(html).toContain("text-5xl");
    expect(html).toContain("leading-tight");
    expect(html).not.toContain("text-sm");
    expect(html).not.toContain("leading-relaxed");
  });

  it("renders a short run at the multi tier", () => {
    const html = body(note("😀🎉🇸🇪"));
    expect(html).toContain('data-emoji-only="multi"');
    expect(html).toContain("text-3xl");
  });

  it("keeps wrapping, so ten emoji cannot widen the column", () => {
    const html = body(note("😀".repeat(10)));
    expect(html).toContain("break-words");
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("sizes custom emoji with the tier and keeps their alt text", () => {
    const tags = [["emoji", "blob", BLOB]];
    const single = body(note(":blob:", tags));
    expect(single).toContain("size-12");
    expect(single).toContain('alt=":blob:"');
    expect(single).toContain(`src="${BLOB}"`);

    const mixed = body(note("😀 :blob:", tags));
    expect(mixed).toContain('data-emoji-only="multi"');
    expect(mixed).toContain("size-8");
    expect(mixed).not.toContain("size-5");
  });

  it("stays normal for text, an unknown shortcode, or a wall", () => {
    for (const event of [
      note("😀 gm"),
      note(":blob:"),
      note("😀".repeat(11)),
      note("😀 https://example.com"),
      note(":blob:", [["emoji", "blob", "javascript:alert(1)"]]),
    ]) {
      const html = body(event);
      expect(html).not.toContain("data-emoji-only");
      expect(html).toContain("text-sm");
      expect(html).toContain("leading-relaxed");
    }
  });

  it("enlarges only the content after a caller's prefix", () => {
    const html = renderToStaticMarkup(
      <RichText
        event={note("😀")}
        className="text-sm"
        options={{ bigEmoji: true }}
      >
        <span>reply to</span>
      </RichText>,
    );
    // The outer body keeps the caller's size, so the prefix does too…
    expect(html).toMatch(/^<div dir="auto" class="[^"]*text-sm[^"]*">/);
    // …and exactly one inner wrapper, after the prefix, is enlarged.
    expect(html).toMatch(
      /<span>reply to<\/span><div class="text-5xl leading-tight" data-emoji-only="single">/,
    );
    expect(html.match(/data-emoji-only/g)).toHaveLength(1);
  });

  it("does not let a prefix make text emoji-only", () => {
    const html = renderToStaticMarkup(
      <RichText event={note("gm")} options={{ bigEmoji: true }}>
        <span>😀</span>
      </RichText>,
    );
    expect(html).not.toContain("data-emoji-only");
  });
});

describe("the appearance setting", () => {
  it("returns an emoji-only body to normal size when switched off", () => {
    settingsManager.updateSetting("appearance", "bigEmoji", false);
    const html = body(note(":blob: 😀", [["emoji", "blob", BLOB]]));
    expect(html).not.toContain("data-emoji-only");
    expect(html).toContain("text-sm");
    expect(html).toContain("leading-relaxed");
    expect(html).toContain("size-5");
    expect(html).not.toContain("text-3xl");
  });

  it("enlarges again when switched back on", () => {
    settingsManager.updateSetting("appearance", "bigEmoji", false);
    settingsManager.updateSetting("appearance", "bigEmoji", true);
    expect(body(note("😀"))).toContain('data-emoji-only="single"');
  });
});

describe("surfaces that do not opt in", () => {
  it("leaves a plain RichText alone", () => {
    const html = renderToStaticMarkup(<RichText event={note("😀")} />);
    expect(html).not.toContain("data-emoji-only");
    expect(html).not.toContain("text-5xl");
  });

  it("leaves a compact row exactly as it renders with the setting off", () => {
    const event = note(":blob: 😀", [["emoji", "blob", BLOB]]);
    const on = renderToStaticMarkup(<DefaultCompactPreview event={event} />);
    settingsManager.updateSetting("appearance", "bigEmoji", false);
    const off = renderToStaticMarkup(<DefaultCompactPreview event={event} />);

    expect(on).toBe(off);
    expect(on).not.toContain("data-emoji-only");
    // One line, at the row's own size.
    expect(on).toContain("line-clamp-1");
    expect(on).toContain("text-sm leading-none");
    expect(on).toContain("size-5");
  });
});

describe("feed and detail", () => {
  function inStore(node: ReactNode) {
    return renderToStaticMarkup(
      <EventStoreProvider eventStore={eventStore}>{node}</EventStoreProvider>,
    );
  }

  it.each([
    ["a note", 1],
    ["a comment", 1111],
    ["a group chat message", 9],
    ["a live chat message", 1311],
  ])("enlarge %s the same way in both", (_name, kind) => {
    const event = { ...note("😀"), kind };
    const feed = inStore(<KindRenderer event={event} />);
    const detail = inStore(<DetailKindRenderer event={event} />);

    expect(feed).toContain('data-emoji-only="single"');
    expect(detail).toContain('data-emoji-only="single"');
  });

  it("both return to normal size with the setting off", () => {
    settingsManager.updateSetting("appearance", "bigEmoji", false);
    const event = note("😀");
    expect(inStore(<KindRenderer event={event} />)).not.toContain(
      "data-emoji-only",
    );
    expect(inStore(<DetailKindRenderer event={event} />)).not.toContain(
      "data-emoji-only",
    );
  });
});
