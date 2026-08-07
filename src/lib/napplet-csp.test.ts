import { describe, it, expect } from "vitest";
import { injectCspMeta } from "./napplet-csp";

/**
 * The directive string is a security invariant, not formatting. If this test
 * fails, the change needs a security review — not a snapshot update.
 */
const EXPECTED_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "prefetch-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

function policyOf(html: string): string {
  const match = /content="([^"]*)"/.exec(html);
  if (!match) throw new Error("no CSP meta found");
  return match[1];
}

describe("injectCspMeta", () => {
  it("emits the exact Class-1 policy when no origins are granted", () => {
    const html = injectCspMeta("<html><head></head><body></body></html>", []);
    expect(policyOf(html)).toBe(EXPECTED_POLICY);
  });

  it("denies connect-src by default", () => {
    expect(policyOf(injectCspMeta("<head></head>", []))).toContain(
      "connect-src 'none'",
    );
  });

  it("names granted origins in connect-src, deduped and sorted", () => {
    const html = injectCspMeta("<head></head>", [
      "https://b.example",
      "https://a.example",
      "https://b.example",
    ]);
    expect(policyOf(html)).toContain(
      "connect-src https://a.example https://b.example",
    );
  });

  it("inserts the meta as the first element inside an existing head", () => {
    const html = injectCspMeta(
      "<html><head><title>x</title></head><body></body></html>",
      [],
    );
    expect(html).toMatch(/<head><meta http-equiv="Content-Security-Policy"/);
    expect(html.indexOf("<meta")).toBeLessThan(html.indexOf("<title>"));
  });

  it("preserves attributes on the head tag", () => {
    const html = injectCspMeta('<head lang="en"></head>', []);
    expect(html).toContain('<head lang="en"><meta http-equiv=');
  });

  it("synthesizes a head for an html-only document", () => {
    const html = injectCspMeta("<html><body>hi</body></html>", []);
    expect(html).toMatch(/<html><head><meta http-equiv=[^>]*><\/head><body>/);
  });

  it("prefixes a headless fragment", () => {
    const html = injectCspMeta("<p>hi</p>", []);
    expect(html.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(
      true,
    );
    expect(html.endsWith("<p>hi</p>")).toBe(true);
  });

  it("is case-insensitive about the head tag", () => {
    expect(injectCspMeta("<HEAD></HEAD>", [])).toContain("<HEAD><meta");
  });

  it("injects exactly one meta", () => {
    const html = injectCspMeta("<html><head></head></html>", []);
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });
});
