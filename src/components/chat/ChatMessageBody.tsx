import type { ReactNode } from "react";
import { RichText } from "@/components/nostr/RichText";
import type { NostrEvent } from "@/types/nostr";

/**
 * The body of a chat message, as every chat window renders it — NIP-29 groups,
 * NIP-17 DMs, NIP-53 live chat and NIP-10/22 threads all go through
 * `ChatViewer`, and so through this.
 *
 * An emoji-only message renders large, under the user's "Big emoji" setting.
 * `replyPreview` is the quote of the message this one answers; it sits above
 * the body at its own size and never counts towards emoji-only.
 */
export function ChatMessageBody({
  event,
  replyPreview,
}: {
  event: NostrEvent;
  replyPreview?: ReactNode;
}) {
  return (
    <RichText
      className="text-sm leading-tight"
      event={event}
      options={{ bigEmoji: true }}
    >
      {replyPreview || undefined}
    </RichText>
  );
}
