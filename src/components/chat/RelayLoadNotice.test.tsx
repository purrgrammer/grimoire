import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RelayLoadNotice } from "./RelayLoadNotice";
import type { RelayLoadState } from "@/lib/relay-subscription";

describe("RelayLoadNotice", () => {
  it("explains auth-required without offering to sign a nonexistent challenge", () => {
    const html = renderToStaticMarkup(
      <RelayLoadNotice
        state={{
          status: "partial",
          relays: { "wss://auth.example/": "auth-required" },
        }}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Authentication required");
    expect(html).toContain("sent no AUTH challenge");
    expect(html).not.toContain(">Authenticate<");
    // Rendered through RelayLink, not as a raw URL.
    expect(html).toContain('title="auth.example"');
    expect(html).not.toContain("No messages yet");
  });

  it("distinguishes timeouts from auth failures", () => {
    const html = renderToStaticMarkup(
      <RelayLoadNotice
        state={{
          status: "partial",
          relays: { "wss://silent.example/": "timeout" },
        }}
      />,
    );
    expect(html).toContain("Timed out");
    expect(html).not.toContain("Authentication required");
  });

  it("disappears when the same read recovers", () => {
    const state: RelayLoadState = {
      status: "complete",
      relays: { "wss://auth.example/": "eose" },
    };
    expect(renderToStaticMarkup(<RelayLoadNotice state={state} />)).toBe("");
    expect(renderToStaticMarkup(<RelayLoadNotice />)).toBe("");
  });
});
