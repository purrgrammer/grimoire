/**
 * Where the "New messages" line goes.
 *
 * Ported from armada's `useNewMessagesDivider`, kept pure so the rule can be
 * tested without a render: the first message the reader has NOT already seen
 * and did not write themselves.
 */

import type { Message } from "@/types/chat";

/**
 * The id of the message the divider sits above, or undefined for no divider.
 *
 * `lastRead === 0` means the channel has never been opened, and that gets NO
 * divider on purpose: flagging the entire history of a channel someone just
 * joined is noise, not information. Sidebar badges still show — everything is
 * unread — which is the same split Discord makes.
 *
 * Strictly after `lastRead`: the stamp is a message's own timestamp, so an
 * inclusive test would put the line above the last message the reader saw.
 *
 * The `type !== "system"` clause is a deliberate addition to armada's rule
 * rather than part of the port. It is inert for Concord — every Concord message
 * maps to `type: "user"` — but a protocol that synthesises join/leave notices
 * should not have one of them be the thing the divider points at.
 */
export function findDividerId(
  messages: readonly Message[],
  lastRead: number,
  selfPubkey?: string,
): string | undefined {
  if (lastRead <= 0) return undefined;
  for (const message of messages) {
    if (message.timestamp <= lastRead) continue;
    if (selfPubkey && message.author === selfPubkey) continue;
    if (message.type === "system") continue;
    return message.id;
  }
  return undefined;
}
