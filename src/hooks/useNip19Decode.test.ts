/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNip19Decode } from "./useNip19Decode";
import { nip19 } from "nostr-tools";

describe("useNip19Decode", () => {
  // Test data
  const testPubkey =
    "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const testEventId =
    "d7dd5eb3ab747e16f8d0212d53032ea2a7cadef53837e5a6c66d42849fcb9027";

  describe("npub decoding", () => {
    it("should decode valid npub identifier", () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result } = renderHook(() => useNip19Decode(npub));

      expect(result.current.decoded).toEqual({
        type: "npub",
        data: testPubkey,
      });
      expect(result.current.error).toBeNull();
    });

    it("should validate expected type for npub", () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result } = renderHook(() => useNip19Decode(npub, "npub"));

      expect(result.current.decoded).toEqual({
        type: "npub",
        data: testPubkey,
      });
      expect(result.current.error).toBeNull();
    });

    it("should error when expected type doesn't match", () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result } = renderHook(() => useNip19Decode(npub, "note"));

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toContain("expected note, got npub");
    });
  });

  describe("note decoding", () => {
    it("should decode valid note identifier", () => {
      const note = nip19.noteEncode(testEventId);
      const { result } = renderHook(() => useNip19Decode(note));

      expect(result.current.decoded).toEqual({
        type: "note",
        data: testEventId,
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("nevent decoding", () => {
    it("should decode valid nevent identifier", () => {
      const nevent = nip19.neventEncode({
        id: testEventId,
        relays: ["wss://relay.example.com"],
      });
      const { result } = renderHook(() => useNip19Decode(nevent));

      expect(result.current.decoded?.type).toBe("nevent");
      expect(result.current.decoded?.data).toEqual({
        id: testEventId,
        relays: ["wss://relay.example.com"],
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("naddr decoding", () => {
    it("should decode valid naddr identifier", () => {
      const naddr = nip19.naddrEncode({
        kind: 30777,
        pubkey: testPubkey,
        identifier: "test-spellbook",
        relays: ["wss://relay.example.com"],
      });
      const { result } = renderHook(() => useNip19Decode(naddr));

      expect(result.current.decoded?.type).toBe("naddr");
      expect(result.current.decoded?.data).toEqual({
        kind: 30777,
        pubkey: testPubkey,
        identifier: "test-spellbook",
        relays: ["wss://relay.example.com"],
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should handle missing identifier", () => {
      const { result } = renderHook(() => useNip19Decode(undefined));

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toBe("No identifier provided");
    });

    it("should handle invalid identifier format", () => {
      const { result } = renderHook(() =>
        useNip19Decode("invalid-identifier")
      );

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("should handle corrupted bech32 string", () => {
      const { result } = renderHook(() =>
        useNip19Decode("npub1invalidbech32string")
      );

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toBeTruthy();
    });
  });

  describe("memoization", () => {
    it("should memoize results for same identifier", () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result, rerender } = renderHook(
        ({ id }: { id: string | undefined }) => useNip19Decode(id),
        {
          initialProps: { id: npub as string },
        }
      );

      const firstResult = result.current;
      expect(firstResult.decoded?.type).toBe("npub");

      // Rerender with same identifier
      rerender({ id: npub as string });

      // Should return exact same object reference (memoized)
      expect(result.current).toBe(firstResult);
    });

    it("should recompute when identifier changes", () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result, rerender } = renderHook(
        ({ id }: { id: string | undefined }) => useNip19Decode(id),
        {
          initialProps: { id: npub as string },
        }
      );

      expect(result.current.decoded?.type).toBe("npub");

      // Change to note
      const note = nip19.noteEncode(testEventId);
      rerender({ id: note });

      expect(result.current.decoded?.type).toBe("note");
      expect(result.current.error).toBeNull();
    });
  });
});
