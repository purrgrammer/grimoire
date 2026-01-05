import { createSpellbook, slugify } from "@/lib/spellbook-manager";
import { SpellbookEvent } from "@/types/spell";
import { GrimoireState } from "@/types/app";
import { SpellbookContent } from "@/types/spell";
import accountManager from "@/services/accounts";
import type { ActionContext } from "applesauce-actions";

export interface PublishSpellbookOptions {
  state: GrimoireState;
  title: string;
  description?: string;
  workspaceIds?: string[];
  content?: SpellbookContent; // Optional explicit content
}

/**
 * Publishes a spellbook (Kind 30777) to Nostr
 *
 * This action:
 * 1. Validates inputs (title, account, signer)
 * 2. Creates spellbook event from state or explicit content
 * 3. Signs the event using the action runner's factory
 * 4. Publishes the signed event via ActionRunner
 *
 * NOTE: This action does NOT mark the local spellbook as published.
 * The caller should use hub.exec() and call markSpellbookPublished()
 * AFTER successful publish to ensure data consistency.
 *
 * @param options - Spellbook publishing options
 * @returns Action for ActionRunner
 *
 * @throws Error if title is empty, no active account, or no signer available
 *
 * @example
 * ```typescript
 * // Publish via ActionRunner with proper side-effect handling
 * const event = await lastValueFrom(hub.exec(PublishSpellbook, options));
 * if (event) {
 *   // Only mark as published AFTER successful relay publish
 *   await markSpellbookPublished(localId, event as SpellbookEvent);
 * }
 * ```
 */
export function PublishSpellbook(options: PublishSpellbookOptions) {
  const { state, title, description, workspaceIds, content } = options;

  return async function ({
    factory,
    sign,
    publish,
  }: ActionContext): Promise<void> {
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

    // 3. Build draft using factory from context
    const draft = await factory.build({
      kind: eventProps.kind,
      content: eventProps.content,
      tags: eventProps.tags,
    });

    // 4. Sign and publish the event
    const event = (await sign(draft)) as SpellbookEvent;

    // 5. Publish event - ActionRunner handles relay selection
    // NOTE: Caller is responsible for marking local spellbook as published
    // after successful publish using markSpellbookPublished()
    await publish(event);
  };
}
