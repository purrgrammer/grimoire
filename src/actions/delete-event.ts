import accountManager from "@/services/accounts";
import publishService from "@/services/publish-service";
import { EventFactory } from "applesauce-core/event-factory";
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

    // Publish via centralized PublishService
    // Relay selection is handled automatically (outbox + state + aggregators)
    const result = await publishService.publish(event);

    if (!result.ok) {
      const errors = result.failed
        .map((f) => `${f.relay}: ${f.error}`)
        .join(", ");
      throw new Error(`Failed to publish deletion event. Errors: ${errors}`);
    }
  }
}
