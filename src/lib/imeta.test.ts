import { describe, it, expect } from "vitest";
import { getAspectRatioFromDimensions } from "./imeta";

describe("getAspectRatioFromDimensions", () => {
  it("should parse valid dimension string", () => {
    expect(getAspectRatioFromDimensions("1920x1080")).toBe("1920/1080");
    expect(getAspectRatioFromDimensions("800x600")).toBe("800/600");
    expect(getAspectRatioFromDimensions("1x1")).toBe("1/1");
  });

  it("should return undefined for invalid formats", () => {
    expect(getAspectRatioFromDimensions("1920")).toBe(undefined);
    expect(getAspectRatioFromDimensions("1920 x 1080")).toBe(undefined);
    expect(getAspectRatioFromDimensions("1920:1080")).toBe(undefined);
    expect(getAspectRatioFromDimensions("abc x def")).toBe(undefined);
  });

  it("should return undefined for invalid dimensions", () => {
    expect(getAspectRatioFromDimensions("0x1080")).toBe(undefined);
    expect(getAspectRatioFromDimensions("1920x0")).toBe(undefined);
    expect(getAspectRatioFromDimensions("-1920x1080")).toBe(undefined);
  });

  it("should return undefined for empty or missing input", () => {
    expect(getAspectRatioFromDimensions("")).toBe(undefined);
    expect(getAspectRatioFromDimensions(undefined)).toBe(undefined);
  });
});
