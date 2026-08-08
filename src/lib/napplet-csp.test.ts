// @vitest-environment happy-dom
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
  "media-src 'none'",
  "font-src data:",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "prefetch-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

/** The only difference the `media:remote` grant may make. */
const EXPECTED_POLICY_WITH_MEDIA = EXPECTED_POLICY.replace(
  "img-src data: blob:; media-src 'none'; font-src data:",
  "img-src data: blob: https:; media-src data: blob: https:; font-src data: https:",
);

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

  // The grant must widen media and nothing else. In particular it must never
  // touch connect-src, script-src or frame-ancestors: it exists so images
  // render, not to open a network.
  it("widens only media directives when remote media is granted", () => {
    const html = injectCspMeta("<head></head>", [], { remoteMedia: true });
    expect(policyOf(html)).toBe(EXPECTED_POLICY_WITH_MEDIA);
  });

  it("keeps the strict policy when remote media is explicitly withheld", () => {
    const html = injectCspMeta("<head></head>", [], { remoteMedia: false });
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
    expect(html.indexOf("<meta")).toBeLessThan(html.indexOf("<title>"));
  });

  it("synthesizes a head for an html-only document", () => {
    const html = injectCspMeta("<html><body>hi</body></html>", []);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("hi");
  });

  it("prefixes a headless fragment", () => {
    const html = injectCspMeta("<p>hi</p>", []);
    expect(html.indexOf("<meta")).toBeLessThan(html.indexOf("<p>hi</p>"));
  });

  it("is case-insensitive about the head tag", () => {
    expect(injectCspMeta("<HEAD></HEAD>", [])).toContain(
      "Content-Security-Policy",
    );
  });

  // The napplet body is attacker-controlled. Both of these defeat a regex
  // injector: the first runs script before the policy is parsed, the second
  // hides the policy inside a comment so the document ships without one.
  it("keeps the meta ahead of a script placed before the head token", () => {
    const html = injectCspMeta(
      "<script>evil()</script><html><head></head><body></body></html>",
      [],
    );
    expect(html.indexOf("<meta")).toBeLessThan(html.indexOf("evil()"));
  });

  it("is not fooled by a commented-out head", () => {
    const html = injectCspMeta(
      "<!--<head>--><html><head><script>evil()</script></head><body></body></html>",
      [],
    );
    const metaAt = html.indexOf("<meta");
    expect(metaAt).toBeGreaterThan(-1);
    // The meta must not land inside the decoy comment.
    expect(html.slice(0, metaAt)).not.toContain("<!--<head>");
    expect(metaAt).toBeLessThan(html.indexOf("evil()"));
  });

  it("does not execute scripts while parsing", () => {
    const marker = "__napplet_csp_probe__";
    injectCspMeta(
      `<html><head><script>globalThis.${marker}=1</script></head></html>`,
      [],
    );
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  it("injects exactly one meta", () => {
    const html = injectCspMeta("<html><head></head></html>", []);
    expect(html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });
});
