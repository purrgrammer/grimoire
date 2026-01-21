import accountManager from "@/services/accounts";
import pool from "@/services/relay-pool";
import { EventFactory } from "applesauce-core/event-factory";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { mergeRelaySets } from "applesauce-core/helpers";
import { grimoireStateAtom } from "@/core/state";
import { getDefaultStore } from "jotai";
import { NostrEvent } from "@/types/nostr";
import { settingsManager } from "@/services/settings";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

export class DeleteEventAction {
  type = "delete-event";
  label = "Delete Event";

  async execute(
    item: { event?: NostrEvent },
    reason: string = "",
  ): Promise<void> {
    if (!item.event) throw new Error("Item has no event to delete");

    const account = accountManager.active;
    if (!account) throw new Error("No active account");

    const signer = account.signer;
    if (!signer) throw new Error("No signer available");

    const factory = new EventFactory({ signer });

    const draft = await factory.delete([item.event], reason);

    // Add client tag if enabled in settings
    if (settingsManager.getSetting("post", "includeClientTag")) {
      draft.tags.push(GRIMOIRE_CLIENT_TAG);
    }

    const event = await factory.sign(draft);

    // Get write relays from cache and state
    const authorWriteRelays =
      (await relayListCache.getOutboxRelays(account.pubkey)) || [];

    const store = getDefaultStore();
    const state = store.get(grimoireStateAtom);
    const stateWriteRelays =
      state.activeAccount?.relays?.filter((r) => r.write).map((r) => r.url) ||
      [];

    // Combine all relay sources
    const writeRelays = mergeRelaySets(
      authorWriteRelays,
      stateWriteRelays,
      AGGREGATOR_RELAYS,
    );

    // Publish to all target relays
    await pool.publish(writeRelays, event);
  }
}
