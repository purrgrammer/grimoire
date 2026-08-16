/**
 * Jumping to a message the timeline has not loaded yet.
 *
 * Clicking a reply preview used to be silent whenever the parent was older than
 * the loaded window — which on a channel anyone has been reading for a while is
 * most of the time. The parent is not missing, it is simply below the page the
 * viewer holds, and the adapter already knows how to fetch deeper. So the click
 * PAGES: fetch, look again, fetch, until the message shows up or the walk hits
 * its bound.
 *
 * The bound is not a performance guard, it is an honesty guard. A message can be
 * genuinely unreachable — sealed under an epoch this member holds no key for,
 * expired under a disappearing timer, or simply deeper than the relays still
 * carry — and walking forever would leave a spinner running against a history
 * that is never going to answer. {@link MAX_JUMP_PAGES} pages, then say so.
 *
 * The walk reads the timeline through refs rather than through its own closure:
 * each page lands by way of the adapter's standing emitter and React's render,
 * so a loop holding the array it started with would page past a message that had
 * already arrived. The same reason the landing scroll waits for the row to
 * exist in the RENDERED array rather than scrolling to an index computed from
 * the page it just fetched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { VirtuosoHandle } from "react-virtuoso";

import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation, Message } from "@/types/chat";

/**
 * How many pages one jump may walk back.
 *
 * Armada's analogous bound is 6 (`LOAD_OLDER_MAX_PAGES`, `channelSync.ts`).
 * Higher here because jump-to-date deliberately reaches further than a single
 * "load older" gesture, and each page is one bounded store read plus one
 * backfill the relay would have served anyway.
 */
export const MAX_JUMP_PAGES = 10;

/** How long a landed row stays highlighted, in ms. */
export const JUMP_FLASH_MS = 1_600;

/** How long to wait for a page to reach the render, and in what steps. */
const SETTLE_STEP_MS = 25;
const SETTLE_STEPS = 40;

export type JumpTarget =
  { kind: "id"; id: string } | { kind: "date"; ts: number };

export interface JumpState {
  /** Pages this walk has already spent. */
  pagesUsed: number;
  /** Whether the protocol still has history to hand over. */
  hasMore: boolean;
}

export type JumpAction = "found" | "page" | "give-up";

/**
 * What the walk should do next, given what is loaded.
 *
 * Pure, and the whole decision — the hook around it only performs the fetching
 * and the scrolling. `messages` is oldest-first, as every adapter emits.
 */
export function nextJumpAction(
  state: JumpState,
  messages: readonly Message[],
  target: JumpTarget,
): JumpAction {
  // Nothing loaded is not "page": paging needs an oldest row to page BELOW, and
  // an empty timeline has none — asking anyway would fetch from the epoch.
  if (messages.length === 0) return "give-up";
  const reached =
    target.kind === "id"
      ? messages.some((m) => m.id === target.id)
      : // A date is reached once the loaded window starts at or BEFORE it —
        // only then is the first message on or after that date the real one
        // rather than whichever happens to be oldest.
        messages[0].timestamp <= target.ts;
  if (reached) return "found";
  if (state.hasMore && state.pagesUsed < MAX_JUMP_PAGES) return "page";
  return "give-up";
}

/**
 * The message a jump should land on, or undefined if the window cannot answer.
 *
 * For a date that is the first message ON or after it — the top of that day —
 * which is where a reader asking "what happened on the 3rd" wants to start.
 */
export function jumpLandingId(
  messages: readonly Message[],
  target: JumpTarget,
): string | undefined {
  if (target.kind === "id") {
    return messages.some((m) => m.id === target.id) ? target.id : undefined;
  }
  return messages.find((m) => m.timestamp >= target.ts)?.id;
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface UseJumpToMessageOptions {
  adapter: ChatProtocolAdapter;
  conversation: Conversation | null;
  /** The emitted timeline, oldest first. */
  messages: Message[] | undefined;
  /** Whether `loadMoreMessages` repaints for this protocol. */
  canPage: boolean;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  /** Where a message id sits in the RENDERED array, or -1. */
  indexOfMessage: (messageId: string) => number;
  /** A short page means the end of the history — the caller's own constant. */
  pageSize: number;
}

export function useJumpToMessage({
  adapter,
  conversation,
  messages,
  canPage,
  virtuosoRef,
  indexOfMessage,
  pageSize,
}: UseJumpToMessageOptions) {
  const [flashId, setFlashId] = useState<string | undefined>();
  const [isJumping, setIsJumping] = useState(false);

  // What the walk reads between pages. Refs rather than the callback's closure:
  // a page arrives as a re-render, which a running async function never sees.
  const messagesRef = useRef(messages);
  const indexRef = useRef(indexOfMessage);
  const running = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    messagesRef.current = messages;
    indexRef.current = indexOfMessage;
  });
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  /** Scroll to a row once it exists on screen, and mark where it landed. */
  const land = useCallback(
    async (messageId: string | undefined) => {
      if (!messageId) return;
      for (let step = 0; step < SETTLE_STEPS; step++) {
        const index = indexRef.current(messageId);
        if (index >= 0) {
          virtuosoRef.current?.scrollToIndex({
            index,
            align: "center",
            behavior: "smooth",
          });
          setFlashId(messageId);
          clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(
            () => setFlashId(undefined),
            JUMP_FLASH_MS,
          );
          return;
        }
        await delay(SETTLE_STEP_MS);
      }
    },
    [virtuosoRef],
  );

  const jump = useCallback(
    async (target: JumpTarget) => {
      // One walk at a time. A second click while the first is paging would
      // fight it for the same `before` boundary and double every fetch.
      if (running.current || !conversation) return;
      running.current = true;
      setIsJumping(true);
      try {
        let pagesUsed = 0;
        let hasMore = canPage;
        for (;;) {
          const loaded = messagesRef.current ?? [];
          const action = nextJumpAction({ pagesUsed, hasMore }, loaded, target);
          if (action === "found") {
            await land(jumpLandingId(loaded, target));
            return;
          }
          if (action === "give-up") {
            // A date always lands somewhere and says why; an id that was never
            // paged for stays silent, which is what a reply preview click on a
            // whole-thread protocol has always done.
            if (target.kind === "date") {
              toast.info(
                "Nothing that far back is readable on this device — showing the oldest message there is.",
              );
              await land(loaded[0]?.id);
            } else if (pagesUsed > 0) {
              toast.info(
                "That message is beyond the history this device can read.",
              );
            }
            return;
          }

          const before = loaded[0]?.timestamp;
          if (before === undefined) return;
          const page = await adapter.loadMoreMessages(conversation, before);
          pagesUsed += 1;
          if (page.length < pageSize) hasMore = false;

          // Wait for the widened window to reach the render before looking
          // again — the adapter publishes through its emitter, not through this
          // promise's value.
          const seen = messagesRef.current;
          for (
            let step = 0;
            step < SETTLE_STEPS && messagesRef.current === seen;
            step++
          ) {
            await delay(SETTLE_STEP_MS);
          }
        }
      } catch (error) {
        console.warn("[Chat] jump failed:", error);
      } finally {
        running.current = false;
        setIsJumping(false);
      }
    },
    [adapter, canPage, conversation, land, pageSize],
  );

  return { jump, flashId, isJumping };
}
