import { describe, expect, it } from "vitest";

import { contentText } from "./message-content";

describe("contentText", () => {
  it("passes a string through", () => {
    expect(contentText("hello")).toBe("hello");
  });

  it("is empty for the absent forms", () => {
    expect(contentText(null)).toBe("");
    expect(contentText(undefined)).toBe("");
    expect(contentText([])).toBe("");
  });

  it("joins text parts in order", () => {
    expect(
      contentText([
        { type: "text", text: "one " },
        { type: "text", text: "two" },
      ]),
    ).toBe("one two");
  });

  it("drops image parts, keeping the text around them", () => {
    expect(
      contentText([
        { type: "text", text: "see " },
        { type: "image", url: "https://example.com/a.png" },
        { type: "text", text: "this" },
        { type: "image", mediaType: "image/png", data: "AAAA" },
      ]),
    ).toBe("see this");
  });
});
