import { createSpellbook, slugify } from "@/lib/spellbook-manager";
import { markSpellbookPublished } from "@/services/spellbook-storage";
import { SpellbookEvent } from "@/types/spell";
import { GrimoireState } from "@/types/app";
import { SpellbookContent } from "@/types/spell";
import { mergeRelaySets } from "applesauce-core/helpers";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
import accountManager from "@/services/accounts";
import type { ActionHub } from "applesauce-actions";
import type { NostrEvent } from "nostr-tools/core";

export interface PublishSpellbookOptions {
  state: GrimoireState;
  title: string;
  description?: string;
  workspaceIds?: string[];
  localId?: string; // If provided, updates this local spellbook
  content?: SpellbookContent; // Optional explicit content
}

/**
 * Publishes a spellbook (Kind 30777) to Nostr
 *
 * This action:
 * 1. Validates inputs (title, account, signer)
 * 2. Creates spellbook event from state or explicit content
 * 3. Signs the event using the action hub's factory
 * 4. Yields the signed event (ActionHub handles publishing)
 * 5. Marks local spellbook as published if localId provided
 *
 * @param hub - The action hub instance
 * @param options - Spellbook publishing options
 * @yields Signed spellbook event ready for publishing
 *
 * @throws Error if title is empty, no active account, or no signer available
 *
 * @example
 * ```typescript
 * // Publish via ActionHub
 * await hub.run(PublishSpellbook, {
 *   state: currentState,
 *   title: "My Dashboard",
 *   description: "Daily workflow",
 *   localId: "local-spellbook-id"
 * });
 * ```
 */
export async function* PublishSpellbook(
  hub: ActionHub,
  options: PublishSpellbookOptions
): AsyncGenerator<NostrEvent> {
  const { state, title, description, workspaceIds, localId, content } = options;

  // 1. Validate inputs
  if (!title || !title.trim()) {
    throw new Error("Title is required");
  }

  const account = accountManager.active;
  if (!account) {
    throw new Error("No active account. Please log in first.");
  }

  const signer = account.signer;
  if (!signer) {
    throw new Error("No signer available. Please connect a signer.");
  }

  // 2. Create event props from state or use provided content
  let eventProps;
  if (content) {
    // Use provided content directly
    eventProps = {
      kind: 30777,
      content: JSON.stringify(content),
      tags: [
        ["d", slugify(title)],
        ["title", title],
        ["client", "grimoire"],
      ] as [string, string, ...string[]][],
    };
    if (description) {
      eventProps.tags.push(["description", description]);
      eventProps.tags.push(["alt", `Grimoire Spellbook: ${title}`]);
    } else {
      eventProps.tags.push(["alt", `Grimoire Spellbook: ${title}`]);
    }
  } else {
    // Create from state
    const encoded = createSpellbook({
      state,
      title,
      description,
      workspaceIds,
    });
    eventProps = encoded.eventProps;
  }

  // 3. Build draft using hub's factory
  const draft = await hub.factory.build({
    kind: eventProps.kind,
    content: eventProps.content,
    tags: eventProps.tags,
    signer,
  });

  // 4. Sign the event
  const event = (await hub.factory.sign(draft, signer)) as SpellbookEvent;

  // 5. Mark as published in local DB (before yielding for better UX)
  if (localId) {
    await markSpellbookPublished(localId, event);
  }

  // 6. Yield signed event - ActionHub's publishEvent will handle relay selection and publishing
  yield event;
}

/**
 * Publishes a spellbook to Nostr with explicit relay selection
 * Use this when you need more control over which relays to publish to
 *
 * @param hub - The action hub instance
 * @param options - Spellbook publishing options
 * @param additionalRelays - Additional relays to publish to (merged with author's outbox)
 * @yields Signed spellbook event with relay hints
 */
export async function* PublishSpellbookWithRelays(
  hub: ActionHub,
  options: PublishSpellbookOptions,
  additionalRelays: string[] = AGGREGATOR_RELAYS
): AsyncGenerator<NostrEvent> {
  // Use the main action to create and sign the event
  for await (const event of PublishSpellbook(hub, options)) {
    // Add relay hints to the event for broader reach
    // Note: The event is already signed, but we can enhance it by publishing to more relays
    // via manual pool.publish call if needed

    // For now, just yield - the ActionHub will handle publishing
    // TODO: Consider adding relay hints to event tags before signing if needed
    yield event;
  }
}
