import { LocalSpell } from "@/services/db";
import accountManager from "@/services/accounts";
import { encodeSpell } from "@/lib/spell-conversion";
import { markSpellPublished } from "@/services/spell-storage";
import { EventFactory } from "applesauce-core/event-factory";
import { SpellEvent } from "@/types/spell";
import { relayListCache } from "@/services/relay-list-cache";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import { mergeRelaySets } from "applesauce-core/helpers";
import { publishingService } from "@/services/publishing";

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

      const draft = await factory.build({
        kind: 777,

        content: encoded.content,

        tags: encoded.tags,
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

    // Publish to all target relays using PublishingService
    const result = await publishingService.publish(event, {
      mode: "explicit",
      relays,
    });

    // Only mark as published if at least one relay succeeded
    if (result.status !== "failed") {
      await markSpellPublished(spell.id, event);
    } else {
      throw new Error("Failed to publish spell to any relay");
    }
  }
}
