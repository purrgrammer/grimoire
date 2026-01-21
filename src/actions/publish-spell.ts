import { LocalSpell } from "@/services/db";
import accountManager from "@/services/accounts";
import pool from "@/services/relay-pool";
import { encodeSpell } from "@/lib/spell-conversion";
import { markSpellPublished } from "@/services/spell-storage";
import { EventFactory } from "applesauce-core/event-factory";
import { SpellEvent } from "@/types/spell";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { mergeRelaySets } from "applesauce-core/helpers";
import eventStore from "@/services/event-store";
import { settingsManager } from "@/services/settings";
import { GRIMOIRE_CLIENT_TAG } from "@/constants/app";

export class PublishSpellAction {
  type = "publish-spell";
  label = "Publish Spell";

  async execute(spell: LocalSpell, targetRelays?: string[]): Promise<void> {
    const account = accountManager.active;

    if (!account) throw new Error("No active account");

    let event: SpellEvent;

    if (spell.isPublished && spell.event) {
      // Use existing signed event for rebroadcasting

      event = spell.event;
    } else {
      const signer = account.signer;

      if (!signer) throw new Error("No signer available");

      const encoded = encodeSpell({
        command: spell.command,

        name: spell.name,

        description: spell.description,
      });

      const factory = new EventFactory({ signer });

      // Add client tag if enabled in settings
      const tags = [...encoded.tags];
      if (settingsManager.getSetting("post", "includeClientTag")) {
        tags.push(GRIMOIRE_CLIENT_TAG);
      }

      const draft = await factory.build({
        kind: 777,

        content: encoded.content,

        tags,
      });

      event = (await factory.sign(draft)) as SpellEvent;
    }

    // Use provided relays or fallback to author's write relays + aggregators

    let relays = targetRelays;

    if (!relays || relays.length === 0) {
      const authorWriteRelays =
        (await relayListCache.getOutboxRelays(account.pubkey)) || [];

      relays = mergeRelaySets(
        event.tags.find((t) => t[0] === "relays")?.slice(1) || [],

        authorWriteRelays,

        AGGREGATOR_RELAYS,
      );
    }

    // Publish to all target relays

    await pool.publish(relays, event);

    // Add to event store for immediate availability
    eventStore.add(event);

    await markSpellPublished(spell.id, event);
  }
}
