import { createSpellbook, slugify } from "@/lib/spellbook-manager";
import { markSpellbookPublished } from "@/services/spellbook-storage";
import { SpellbookEvent } from "@/types/spell";
import { GrimoireState } from "@/types/app";
import { SpellbookContent } from "@/types/spell";
import accountManager from "@/services/accounts";
import type { ActionContext } from "applesauce-actions";
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
 * @param options - Spellbook publishing options
 * @returns Action generator for ActionHub
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
export function PublishSpellbook(options: PublishSpellbookOptions) {
  const { state, title, description, workspaceIds, localId, content } = options;

  return async function* ({
    factory,
  }: ActionContext): AsyncGenerator<NostrEvent> {
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

    // 4. Sign the event
    const event = (await factory.sign(draft)) as SpellbookEvent;

    // 5. Mark as published in local DB (before yielding for better UX)
    if (localId) {
      await markSpellbookPublished(localId, event);
    }

    // 6. Yield signed event - ActionHub's publishEvent will handle relay selection and publishing
    yield event;
  };
}
