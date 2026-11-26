import type { NostrEvent } from "@/types/nostr";

/**
 * NIP-99 fixtures. Unsigned and shaped like events: renderers and parsers
 * never verify, and nothing here is ever published. The pubkey is a
 * placeholder, not anyone's key.
 */
export const SELLER = "c".repeat(64);

let counter = 0;

export function classified(
  tags: string[][],
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  counter += 1;
  return {
    id: counter.toString(16).padStart(64, "0"),
    kind: 30402,
    pubkey: SELLER,
    created_at: 1_764_000_000,
    content: "",
    sig: "0".repeat(128),
    tags,
    ...overrides,
  } as NostrEvent;
}

/** A complete listing, modelled on the NIP-99 example event. */
export const bikeListing = () =>
  classified(
    [
      ["d", "vintage-road-bike"],
      ["title", "Vintage steel road bike, 56cm"],
      ["summary", "Reynolds 531 frame, new tyres, collection only"],
      ["published_at", "1763000000"],
      ["location", "Lisbon, Portugal"],
      ["g", "eycs0p"],
      ["price", "450", "EUR"],
      ["status", "active"],
      ["t", "bikes"],
      ["t", "cycling"],
      ["t", "Bikes"],
      ["image", "https://example.com/bike-1.jpg", "1200x800"],
      ["image", "https://example.com/bike-2.jpg"],
    ],
    {
      content:
        "Lovely **1980s** road bike.\n\n- Shimano 600 groupset\n- New Continental tyres\n\nMore photos at https://example.com/bike",
    },
  );

export const roomRental = () =>
  classified([
    ["d", "room"],
    ["title", "Room in shared flat"],
    ["price", "15", "EUR", "month"],
  ]);
