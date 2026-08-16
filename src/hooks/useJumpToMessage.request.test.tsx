// @vitest-environment jsdom
/**
 * A jump asked for from outside, against ChatViewer's real wiring.
 *
 * The unit tests next door cover the walk's decisions. What they cannot cover is
 * the timing that made every search result silently do nothing: `use$` publishes
 * from an effect, so the render where the conversation first resolves still has
 * no messages, and a jump started there gives up on an empty timeline without
 * even a toast — spending the request.
 *
 * So this harness mirrors the two components rather than mocking them: the same
 * two chained `use$` calls with the same dependency arrays, the same
 * `useJumpToMessage`, the same effect, and a parent that swaps the viewer out
 * for a results pane exactly as ConcordViewer does. Everything under test here
 * is timing, and only the real hooks have it.
 */

import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { ReplaySubject, from, map } from "rxjs";
import type { VirtuosoHandle } from "react-virtuoso";

import { useJumpToMessage } from "./useJumpToMessage";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation, Message } from "@/types/chat";

const CHANNELS: Record<string, string[]> = {
  "chan-a": ["a1", "a2"],
  "chan-b": ["b1", "b2"],
};

interface Identifier {
  type: "concord";
  communityId: string;
  channelId: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function message(conversationId: string, id: string, index: number): Message {
  return {
    id,
    conversationId,
    author: "author",
    content: id,
    timestamp: 1_000 + index,
    protocol: "concord",
    event: {
      id,
      pubkey: "author",
      kind: 9,
      content: id,
      tags: [],
      created_at: 1_000 + index,
      sig: "",
    },
  } as Message;
}

/**
 * An adapter that answers the way Concord's does: the conversation resolves
 * asynchronously, and the timeline arrives later still, on a subject cached per
 * conversation so a remount replays what the last one saw.
 */
function fakeAdapter() {
  const timelines = new Map<string, ReplaySubject<Message[]>>();
  const loadMoreMessages = vi.fn(async () => [] as Message[]);
  const adapter = {
    async resolveConversation(identifier: Identifier): Promise<Conversation> {
      await delay(5);
      return {
        id: `${identifier.communityId}:${identifier.channelId}`,
        protocol: "concord",
        participants: [],
      } as unknown as Conversation;
    },
    loadMessages(conversation: Conversation) {
      let subject = timelines.get(conversation.id);
      if (!subject) {
        const created = new ReplaySubject<Message[]>(1);
        subject = created;
        timelines.set(conversation.id, created);
        const channel = conversation.id.split(":")[1] ?? "";
        void delay(5).then(() =>
          created.next(
            (CHANNELS[channel] ?? []).map((id, i) =>
              message(conversation.id, id, i),
            ),
          ),
        );
      }
      return subject.asObservable();
    },
    loadMoreMessages,
  };
  return {
    adapter: adapter as unknown as ChatProtocolAdapter,
    loadMoreMessages,
  };
}

/** ChatViewer's jump wiring, copied rather than imported. */
function ChatViewerLike({
  adapter,
  identifier,
  jumpTo,
  onJumpHandled,
  scrollToIndex,
}: {
  adapter: ChatProtocolAdapter;
  identifier: Identifier;
  jumpTo?: { messageId: string; nonce: number };
  onJumpHandled: (nonce: number) => void;
  scrollToIndex: (arg: unknown) => void;
}) {
  const conversationResult = use$(
    () =>
      from(
        (
          adapter as unknown as {
            resolveConversation: (i: Identifier) => Promise<Conversation>;
          }
        ).resolveConversation(identifier),
      ).pipe(map((conversation) => ({ conversation, identifier }))),
    [adapter, identifier],
  );
  const conversation = conversationResult?.conversation ?? null;
  const resolvedFor = conversationResult?.identifier;

  const messages = use$(
    () => (conversation ? adapter.loadMessages(conversation) : undefined),
    [adapter, conversation],
  );

  const virtuosoRef = useRef({
    scrollToIndex,
  } as unknown as VirtuosoHandle) as React.RefObject<VirtuosoHandle | null>;

  const indexOfMessage = useCallback(
    (messageId: string) =>
      (messages ?? []).findIndex((m) => m.id === messageId),
    [messages],
  );

  const { jump } = useJumpToMessage({
    adapter,
    conversation,
    messages,
    canPage: true,
    virtuosoRef,
    indexOfMessage,
    pageSize: 30,
  });

  const jumpedNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!jumpTo || !conversation || resolvedFor !== identifier) return;
    if (!messages || messages.length === 0) return;
    if (jumpedNonce.current === jumpTo.nonce) return;
    jumpedNonce.current = jumpTo.nonce;
    const { nonce, messageId } = jumpTo;
    void jump({ kind: "id", id: messageId }).then(() => onJumpHandled(nonce));
  }, [
    jumpTo,
    conversation,
    resolvedFor,
    identifier,
    messages,
    jump,
    onJumpHandled,
  ]);

  return <div data-testid="viewer" />;
}

interface Api {
  search: () => void;
  closeSearch: () => void;
  openGuestbook: () => void;
  openHit: (channelId: string, messageId: string) => void;
}

/**
 * ConcordViewer's half: the results AND the guestbook each replace the viewer,
 * and opening a hit has to leave both — the guestbook is an ordinary place to
 * start a search from.
 */
function ConcordViewerLike({
  adapter,
  scrollToIndex,
  onReady,
}: {
  adapter: ChatProtocolAdapter;
  scrollToIndex: (arg: unknown) => void;
  /** Hand the test the gestures a reader would make. */
  onReady: (api: Api) => void;
}) {
  const [channelId, setChannelId] = useState("chan-a");
  const [searching, setSearching] = useState(false);
  const [guestbook, setGuestbook] = useState(false);
  const [jumpTo, setJumpTo] = useState<{ messageId: string; nonce: number }>();

  const identifier = useMemo<Identifier>(
    () => ({ type: "concord", communityId: "comm", channelId }),
    [channelId],
  );

  const search = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  const openGuestbook = useCallback(() => setGuestbook(true), []);
  const openHit = useCallback((channel: string, messageId: string) => {
    setSearching(false);
    setGuestbook(false);
    setChannelId(channel);
    setJumpTo({ messageId, nonce: Math.random() });
  }, []);
  useEffect(() => {
    onReady({ search, closeSearch, openGuestbook, openHit });
  }, [onReady, search, closeSearch, openGuestbook, openHit]);

  const onJumpHandled = useCallback((nonce: number) => {
    setJumpTo((prev) => (prev?.nonce === nonce ? undefined : prev));
  }, []);

  if (searching) return <div data-testid="results" />;
  if (guestbook) return <div data-testid="guestbook" />;
  return (
    <ChatViewerLike
      adapter={adapter}
      identifier={identifier}
      onJumpHandled={onJumpHandled}
      scrollToIndex={scrollToIndex}
      {...(jumpTo ? { jumpTo } : {})}
    />
  );
}

async function mount() {
  const { adapter, loadMoreMessages } = fakeAdapter();
  const scrollToIndex = vi.fn();
  let api: Api = {
    search: () => {},
    closeSearch: () => {},
    openGuestbook: () => {},
    openHit: () => {},
  };
  render(
    <ConcordViewerLike
      adapter={adapter}
      scrollToIndex={scrollToIndex}
      onReady={(next) => {
        api = next;
      }}
    />,
  );
  // Let the first channel resolve and paint, as it has by the time anyone could
  // have typed a query.
  await act(() => delay(40));
  return { api, scrollToIndex, loadMoreMessages };
}

describe("a jump requested while the viewer is being remounted", () => {
  it("lands on a hit in the channel already open", async () => {
    const { api, scrollToIndex } = await mount();

    act(() => api.search());
    act(() => api.openHit("chan-a", "a1"));

    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 0 }),
      ),
    );
  });

  it("lands on a hit in another channel", async () => {
    const { api, scrollToIndex } = await mount();

    act(() => api.search());
    act(() => api.openHit("chan-b", "b2"));

    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 1 }),
      ),
    );
  });

  it("lands on a hit searched for from the guestbook", async () => {
    const { api, scrollToIndex } = await mount();

    act(() => api.openGuestbook());
    act(() => api.search());
    act(() => api.openHit("chan-b", "b1"));

    await waitFor(() =>
      expect(scrollToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ index: 0 }),
      ),
    );
  });

  it("does not jump again when the reader merely comes back from search", async () => {
    const { api, scrollToIndex } = await mount();

    act(() => api.search());
    act(() => api.openHit("chan-a", "a2"));
    await waitFor(() => expect(scrollToIndex).toHaveBeenCalledTimes(1));

    // A new query, then Escape: the viewer unmounts and mounts again with
    // nothing asked for. The request it already honoured must be gone — a ref
    // inside the viewer would not have survived, which is why the parent is
    // what forgets it.
    act(() => api.search());
    await act(() => delay(20));
    act(() => api.closeSearch());
    await act(() => delay(80));
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    // And a second click on the same hit is still a request, not a repeat.
    act(() => api.search());
    act(() => api.openHit("chan-a", "a2"));
    await waitFor(() => expect(scrollToIndex).toHaveBeenCalledTimes(2));
  });
});
