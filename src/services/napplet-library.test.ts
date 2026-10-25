import { describe, expect, it } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { getNappletCatalogId } from "./kehto";
import { installedNappletCatalogId } from "./napplet-library";

describe("installed catalog identity", () => {
  it.each([5129, 15129, 35129])(
    "matches upstream for kind %i addressed by event ID",
    (kind) => {
      const manifest: NostrEvent = {
        id: "a".repeat(64),
        pubkey: "b".repeat(64),
        kind,
        created_at: 0,
        tags: kind === 35129 ? [["d", "viewer"]] : [],
        content: "",
        sig: "",
      };
      expect(
        installedNappletCatalogId({
          coordinate: `id:${manifest.id}`,
          manifest,
        }),
      ).toBe(getNappletCatalogId(manifest));
    },
  );
});
