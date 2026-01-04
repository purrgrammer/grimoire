/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNip19Decode } from "./useNip19Decode";
import { nip19 } from "nostr-tools";

describe("useNip19Decode", () => {
  // Test data
  const testPubkey =
    "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const testEventId =
    "d7dd5eb3ab747e16f8d0212d53032ea2a7cadef53837e5a6c66d42849fcb9027";

  describe("npub decoding", () => {
    it("should decode valid npub identifier", async () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result } = renderHook(() => useNip19Decode(npub));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toEqual({
        type: "npub",
        data: testPubkey,
      });
      expect(result.current.error).toBeNull();
    });

    it("should validate expected type for npub", async () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result } = renderHook(() => useNip19Decode(npub, "npub"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toEqual({
        type: "npub",
        data: testPubkey,
      });
      expect(result.current.error).toBeNull();
    });

    it("should error when expected type doesn't match", async () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result } = renderHook(() => useNip19Decode(npub, "note"));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toContain("expected note, got npub");
    });
  });

  describe("note decoding", () => {
    it("should decode valid note identifier", async () => {
      const note = nip19.noteEncode(testEventId);
      const { result } = renderHook(() => useNip19Decode(note));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toEqual({
        type: "note",
        data: testEventId,
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("nevent decoding", () => {
    it("should decode valid nevent identifier", async () => {
      const nevent = nip19.neventEncode({
        id: testEventId,
        relays: ["wss://relay.example.com"],
      });
      const { result } = renderHook(() => useNip19Decode(nevent));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded?.type).toBe("nevent");
      expect(result.current.decoded?.data).toEqual({
        id: testEventId,
        relays: ["wss://relay.example.com"],
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe("naddr decoding", () => {
    it("should decode valid naddr identifier", async () => {
      const naddr = nip19.naddrEncode({
        kind: 30777,
        pubkey: testPubkey,
        identifier: "test-spellbook",
        relays: ["wss://relay.example.com"],
      });
      const { result } = renderHook(() => useNip19Decode(naddr));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

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
    it("should handle missing identifier", async () => {
      const { result } = renderHook(() => useNip19Decode(undefined));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toBe("No identifier provided");
    });

    it("should handle invalid identifier format", async () => {
      const { result } = renderHook(() =>
        useNip19Decode("invalid-identifier")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("should handle corrupted bech32 string", async () => {
      const { result } = renderHook(() =>
        useNip19Decode("npub1invalidbech32string")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded).toBeNull();
      expect(result.current.error).toBeTruthy();
    });
  });

  describe("retry functionality", () => {
    it("should retry decoding when retry is called", async () => {
      const { result } = renderHook(() =>
        useNip19Decode("invalid-identifier")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeTruthy();

      // Call retry wrapped in act
      act(() => {
        result.current.retry();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should still have error since the identifier is still invalid
      expect(result.current.error).toBeTruthy();
    });
  });

  describe("identifier changes", () => {
    it("should reset state when identifier changes", async () => {
      const npub = nip19.npubEncode(testPubkey);
      const { result, rerender } = renderHook(
        ({ id }: { id: string | undefined }) => useNip19Decode(id),
        {
          initialProps: { id: npub as string },
        }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded?.type).toBe("npub");

      // Change to note
      const note = nip19.noteEncode(testEventId);
      rerender({ id: note });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.decoded?.type).toBe("note");
      expect(result.current.error).toBeNull();
    });
  });
});
