// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import {
  canonicalOrigin,
  getGrantedOrigins,
  grantOrigins,
  revokeOrigins,
  isOriginGranted,
  requestedOrigins,
} from "./napplet-origins";

const D = "calc";
const H = "a".repeat(64);
const H2 = "b".repeat(64);

beforeEach(() => {
  localStorage.clear();
});

describe("canonicalOrigin", () => {
  it("reduces a url to its origin", () => {
    expect(canonicalOrigin("https://a.example/some/path?q=1")).toBe(
      "https://a.example",
    );
  });

  it("keeps a non-default port, which is part of the origin", () => {
    expect(canonicalOrigin("https://a.example:8443/x")).toBe(
      "https://a.example:8443",
    );
  });

  /** Bytes over http are attacker-modifiable in transit. */
  it("refuses http", () => {
    expect(canonicalOrigin("http://a.example")).toBeNull();
  });

  it("refuses non-network schemes", () => {
    expect(canonicalOrigin("javascript:alert(1)")).toBeNull();
    expect(canonicalOrigin("file:///etc/passwd")).toBeNull();
    expect(canonicalOrigin("data:text/html,<b>x</b>")).toBeNull();
  });

  /** A grant the user cannot read is not consent. */
  it("refuses credentialed urls rather than stripping them", () => {
    expect(canonicalOrigin("https://user:pw@a.example")).toBeNull();
  });

  it("refuses garbage", () => {
    expect(canonicalOrigin("not a url")).toBeNull();
    expect(canonicalOrigin("")).toBeNull();
  });
});

describe("origin grants", () => {
  it("start empty", () => {
    expect(getGrantedOrigins(D, H)).toEqual([]);
  });

  it("round-trip, canonicalised and deduped", () => {
    grantOrigins(D, H, [
      "https://a.example/path",
      "https://a.example",
      "https://b.example",
    ]);
    expect(getGrantedOrigins(D, H)).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("drops what cannot be canonicalised rather than coercing it", () => {
    grantOrigins(D, H, [
      "http://a.example",
      "javascript:x",
      "https://ok.example",
    ]);
    expect(getGrantedOrigins(D, H)).toEqual(["https://ok.example"]);
  });

  /** Network reach must not survive an update, like every other capability. */
  it("does not carry across aggregate hashes", () => {
    grantOrigins(D, H, ["https://a.example"]);
    expect(getGrantedOrigins(D, H2)).toEqual([]);
  });

  it("does not carry across napplets", () => {
    grantOrigins(D, H, ["https://a.example"]);
    expect(getGrantedOrigins("other", H)).toEqual([]);
  });

  it("revokes a whole version", () => {
    grantOrigins(D, H, ["https://a.example"]);
    grantOrigins(D, H2, ["https://b.example"]);
    revokeOrigins(D, H);
    expect(getGrantedOrigins(D, H)).toEqual([]);
    expect(getGrantedOrigins(D, H2)).toEqual(["https://b.example"]);
  });

  it("treats a corrupt store as empty", () => {
    localStorage.setItem("napplet:origins", "{not json");
    expect(getGrantedOrigins(D, H)).toEqual([]);
  });
});

describe("isOriginGranted", () => {
  const grants = ["https://granted.example"];

  it("accepts an exact match", () => {
    expect(isOriginGranted("https://granted.example", grants)).toBe(true);
    expect(isOriginGranted("https://granted.example/deep/path", grants)).toBe(
      true,
    );
  });

  it("refuses a lookalike suffix", () => {
    expect(isOriginGranted("https://granted.example.evil.com", grants)).toBe(
      false,
    );
  });

  it("refuses a subdomain — grants do not widen", () => {
    expect(isOriginGranted("https://sub.granted.example", grants)).toBe(false);
  });

  it("refuses the granted origin appearing in a query string", () => {
    expect(
      isOriginGranted(
        "https://evil.example/?u=https://granted.example",
        grants,
      ),
    ).toBe(false);
  });

  it("refuses a scheme downgrade", () => {
    expect(isOriginGranted("http://granted.example", grants)).toBe(false);
  });

  it("refuses a different port", () => {
    expect(isOriginGranted("https://granted.example:8443", grants)).toBe(false);
  });

  it("refuses everything when nothing is granted", () => {
    expect(isOriginGranted("https://granted.example", [])).toBe(false);
  });
});

describe("requestedOrigins", () => {
  it("reads connect tags, canonicalised, deduped and sorted", () => {
    expect(
      requestedOrigins([
        ["connect", "https://b.example/x"],
        ["connect", "https://a.example"],
        ["connect", "https://a.example"],
        ["path", "/index.html", "abc"],
      ]),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("drops connect tags that are not plain https", () => {
    expect(
      requestedOrigins([
        ["connect", "http://a.example"],
        ["connect", "wss://relay.example"],
        ["connect"],
      ]),
    ).toEqual([]);
  });
});
