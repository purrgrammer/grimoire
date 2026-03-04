import { LocalSpell } from "@/services/db";
import accountManager from "@/services/accounts";
import publishService from "@/services/publish-service";
import { selectRelaysForPublish } from "@/services/relay-selection";
import { encodeSpell } from "@/lib/spell-conversion";
import { markSpellPublished } from "@/services/spell-storage";
import { EventFactory } from "applesauce-core/event-factory";
import { SpellEvent } from "@/types/spell";
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

    // Determine relays: explicit target relays or outbox selection with hints
    let relays: string[];
    if (targetRelays && targetRelays.length > 0) {
      relays = targetRelays;
    } else {
      const eventRelayHints =
        event.tags.find((t) => t[0] === "relays")?.slice(1) || [];
      relays = await selectRelaysForPublish(account.pubkey, {
        relayHints: eventRelayHints,
      });
    }

    const result = await publishService.publish(event, relays);

    if (!result.ok) {
      const errors = result.failed
        .map((f) => `${f.relay}: ${f.error}`)
        .join(", ");
      throw new Error(`Failed to publish spell. Errors: ${errors}`);
    }

    await markSpellPublished(spell.id, event);
  }
}
