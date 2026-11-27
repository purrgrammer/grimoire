import { afterEach, describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";

const native = vi.hoisted(() => ({ value: false }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.value },
}));

import {
  CANONICAL_ORIGIN,
  classifyNavigation,
  nostrUriToPath,
  publicOrigin,
  publicUrl,
} from "./platform";

const APP = "https://localhost";
const PUBKEY = "a".repeat(64);
const NPUB = nip19.npubEncode(PUBKEY);

afterEach(() => {
  native.value = false;
  vi.unstubAllGlobals();
});

describe("publicOrigin / publicUrl", () => {
  it("uses the serving origin on the web", () => {
    vi.stubGlobal("window", { location: { origin: "https://preview.app" } });
    expect(publicOrigin()).toBe("https://preview.app");
    expect(publicUrl("/x/y")).toBe("https://preview.app/x/y");
  });

  it("never leaks https://localhost from the app", () => {
    native.value = true;
    vi.stubGlobal("window", { location: { origin: APP } });
    expect(publicOrigin()).toBe(CANONICAL_ORIGIN);
    expect(publicUrl("preview/a/b")).toBe(`${CANONICAL_ORIGIN}/preview/a/b`);
  });
});

describe("nostrUriToPath", () => {
  it("routes the identifiers the router opens", () => {
    expect(nostrUriToPath(`nostr:${NPUB}`)).toBe(`/${NPUB}`);
    const naddr = nip19.naddrEncode({
      kind: 30777,
      pubkey: PUBKEY,
      identifier: "book",
    });
    expect(nostrUriToPath(`nostr:${naddr}`)).toBe(`/${naddr}`);
    expect(nostrUriToPath(`nostr://${naddr}`)).toBe(`/${naddr}`);
  });

  it("maps nprofile to npub, which has a route", () => {
    const nprofile = nip19.nprofileEncode({ pubkey: PUBKEY });
    expect(nostrUriToPath(`nostr:${nprofile}`)).toBe(`/${NPUB}`);
  });

  it("refuses secrets, garbage and broken checksums", () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(1));
    expect(nostrUriToPath(`nostr:${nsec}`)).toBeNull();
    expect(nostrUriToPath("nostr:hello")).toBeNull();
    expect(nostrUriToPath(`nostr:${NPUB.slice(0, -1)}x`)).toBeNull();
    expect(nostrUriToPath("nostr:npub1../../etc")).toBeNull();
  });
});

describe("classifyNavigation", () => {
  it("keeps the app's own and canonical links in the router", () => {
    expect(classifyNavigation("/run?cmd=help", APP)).toEqual({
      kind: "internal",
      path: "/run?cmd=help",
    });
    expect(
      classifyNavigation(`${CANONICAL_ORIGIN}/preview/a/b#x`, APP),
    ).toEqual({ kind: "internal", path: "/preview/a/b#x" });
  });

  it("hands allowlisted schemes to Android", () => {
    for (const url of [
      "https://example.com/a",
      "http://example.com",
      "lightning:lnbc1xyz",
      "bitcoin:bc1qxyz",
      "mailto:a@b.c",
      "nostrconnect://abc?relay=wss%3A%2F%2Fr",
    ]) {
      expect(classifyNavigation(url, APP).kind).toBe("external");
    }
  });

  it("refuses schemes that could run code or reach device data", () => {
    for (const url of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///data/data/rocks.grimoire.app/shared_prefs/x.xml",
      "content://com.android.contacts/contacts",
      "intent://scan/#Intent;scheme=zxing;package=com.evil;end",
      "nostrsigner:{}",
      "blob:https://localhost/uuid",
    ]) {
      expect(classifyNavigation(url, APP)).toMatchObject({ kind: "blocked" });
    }
  });

  it("does not treat look-alike hosts as the app", () => {
    for (const url of [
      "https://grimoire.rocks.evil.com/x",
      "https://localhost.evil.com/",
      "https://evil.com/@grimoire.rocks",
      "https://grimoire.rocks@evil.com/",
    ]) {
      expect(classifyNavigation(url, APP).kind).toBe("external");
    }
  });

  it("routes nostr: URIs or refuses them", () => {
    expect(classifyNavigation(`nostr:${NPUB}`, APP)).toEqual({
      kind: "internal",
      path: `/${NPUB}`,
    });
    expect(classifyNavigation("nostr:nsec1abc", APP).kind).toBe("blocked");
  });
});
