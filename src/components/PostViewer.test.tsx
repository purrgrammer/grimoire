// @vitest-environment happy-dom
/**
 * PostViewer behaviour, driven through the real component.
 *
 * Only the edges that would reach the network or need a browser editor are
 * faked: the tiptap editor (a textarea standing in for it), the publish
 * service, the relay pool and the account. Relay selection, draft
 * persistence and the template that gets signed run for real. Signing uses
 * an ephemeral key generated per run; nothing is ever sent to a relay.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  type EventTemplate,
} from "nostr-tools";
import { BehaviorSubject } from "rxjs";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const SECRET = generateSecretKey();
const PUBKEY = getPublicKey(SECRET);
const signer = {
  getPublicKey: async () => PUBKEY,
  signEvent: async (t: EventTemplate) => finalizeEvent(t, SECRET),
};

const accountState = vi.hoisted(() => ({
  pubkey: "",
  relays: undefined as
    { url: string; read: boolean; write: boolean }[] | undefined,
}));

vi.mock("@/hooks/useAccount", () => ({
  useAccount: () => ({
    pubkey: accountState.pubkey,
    canSign: true,
    signer,
    isLoggedIn: true,
  }),
}));

vi.mock("@/core/state", () => ({
  useGrimoire: () => ({
    state: {
      activeAccount: accountState.relays
        ? { pubkey: accountState.pubkey, relays: accountState.relays }
        : { pubkey: accountState.pubkey },
    },
  }),
}));

vi.mock("@/hooks/useRelayState", () => ({
  useRelayState: () => ({ getRelay: () => undefined }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { post: { includeClientTag: false } },
    updateSetting: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProfileSearch", () => ({
  useProfileSearch: () => ({ searchProfiles: async () => [] }),
}));
vi.mock("@/hooks/useEmojiSearch", () => ({
  useEmojiSearch: () => ({ searchEmojis: async () => [] }),
}));
vi.mock("@/hooks/useBlossomUpload", () => ({
  useBlossomUpload: () => ({ open: vi.fn(), dialog: null }),
}));
vi.mock("@/services/relay-pool", () => ({
  default: { relays$: new BehaviorSubject(new Map()) },
}));

const publishWithUpdates = vi.hoisted(() => vi.fn());
vi.mock("@/services/publish-service", () => ({
  default: {
    publishWithUpdates,
    retryRelays: vi.fn(),
  },
}));

// Inbox lookups are driven by the test: each call is recorded and answered
// (or left hanging) explicitly.
type Resolution =
  | { status: "resolved"; relays: string[]; blocked: string[] }
  | { status: "no-list" }
  | { status: "timeout" }
  | { status: "error"; message: string };
const inboxCalls = vi.hoisted(
  () => [] as { pubkey: string; resolve: (r: Resolution) => void }[],
);
vi.mock("@/services/relay-selection", () => ({
  resolveInboxRelays: (pubkey: string) =>
    new Promise<Resolution>((resolve) => inboxCalls.push({ pubkey, resolve })),
}));
const answer = (pubkey: string, r: Resolution) =>
  act(async () => {
    const pendingCall = [...inboxCalls]
      .reverse()
      .find((c) => c.pubkey === pubkey);
    if (!pendingCall) throw new Error(`no lookup for ${pubkey}`);
    pendingCall.resolve(r);
  });

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("./nostr/UserName", () => ({
  UserName: ({ pubkey }: { pubkey: string }) => (
    <span>{`user-${pubkey.slice(0, 6)}`}</span>
  ),
}));

vi.mock("./nostr/RelayLink", () => ({
  RelayLink: ({ url }: { url: string }) => <span>{url}</span>,
}));
vi.mock("./nostr/kinds", () => ({
  Kind1Renderer: ({ event }: { event: { content: string } }) => (
    <div data-testid="published">{event.content}</div>
  ),
}));

// The editor: a textarea whose value is the note text. Editor JSON is the
// text itself, which is all a draft round-trip needs to prove.
vi.mock("./editor/RichEditor", () => ({
  RichEditor: forwardRef(function FakeEditor(
    props: {
      onChange?: () => void;
      onSubmit?: (
        text: string,
        emoji: unknown[],
        blobs: unknown[],
        addrs: unknown[],
      ) => void;
    },
    ref,
  ) {
    const [text, setText] = useState("");
    const textRef = useRef("");
    textRef.current = text;
    useImperativeHandle(ref, () => ({
      getContent: () => textRef.current,
      getJSON: () => ({ text: textRef.current }),
      setContent: (json: { text?: string }) => {
        textRef.current = json?.text ?? "";
        setText(textRef.current);
        props.onChange?.();
      },
      isEmpty: () => textRef.current.trim() === "",
      clear: () => {
        textRef.current = "";
        setText("");
        props.onChange?.();
      },
      focus: () => {},
      submit: () => props.onSubmit?.(textRef.current, [], [], []),
      insertBlob: () => {},
      getSerializedContent: () => ({
        text: textRef.current,
        emojiTags: [],
        blobAttachments: [],
        addressRefs: [],
      }),
    }));
    return (
      <textarea
        aria-label="note"
        value={text}
        onChange={(e) => {
          textRef.current = e.target.value;
          setText(e.target.value);
          props.onChange?.();
        }}
      />
    );
  }),
}));

import { PostViewer } from "./PostViewer";
import eventStore from "@/services/event-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const W1 = "wss://write-one.example.com/";
const W2 = "wss://write-two.example.com/";
const ADDED = "wss://added.example.com/";
const ADDED_OFF = "wss://added-off.example.com/";
const DRAFT_KEY = `grimoire-post-draft-${PUBKEY}`;

function checkbox(url: string): HTMLElement {
  const el = document.getElementById(url);
  if (!el) throw new Error(`no checkbox for ${url}`);
  return el;
}

const isChecked = (url: string) =>
  checkbox(url).getAttribute("aria-checked") === "true";

/** Waits past the composer's 500ms draft debounce. */
const pastDebounce = () => act(() => new Promise((r) => setTimeout(r, 700)));

function okPublish(relays: string[]) {
  return {
    updates$: new BehaviorSubject({ relay: relays[0], status: "success" }),
    result: Promise.resolve({
      ok: true,
      successful: relays,
      failed: [],
    }),
  };
}

beforeEach(() => {
  localStorage.clear();
  inboxCalls.length = 0;
  toastMock.success.mockReset();
  toastMock.warning.mockReset();
  toastMock.error.mockReset();
  accountState.pubkey = PUBKEY;
  accountState.relays = [
    { url: W1, read: true, write: true },
    { url: W2, read: true, write: true },
  ];
  (publishWithUpdates as Mock).mockReset();
  (publishWithUpdates as Mock).mockImplementation(
    (_event: unknown, relays: string[]) => okPublish(relays),
  );
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Regressions found reading the composer (#post-mention-inbox-relays §2.4)
// ---------------------------------------------------------------------------

describe("PostViewer draft and relay selection", () => {
  it("saves a relay untick even when no key is pressed afterwards", async () => {
    render(<PostViewer />);
    fireEvent.change(screen.getByLabelText("note"), {
      target: { value: "hello" },
    });
    await pastDebounce();

    fireEvent.click(checkbox(W2));
    expect(isChecked(W2)).toBe(false);
    await pastDebounce();

    // Reopen: the untick must have reached the draft.
    cleanup();
    render(<PostViewer />);
    await waitFor(() =>
      expect((screen.getByLabelText("note") as HTMLTextAreaElement).value).toBe(
        "hello",
      ),
    );
    expect(isChecked(W2)).toBe(false);
    expect(isChecked(W1)).toBe(true);
  });

  it("keeps a restored draft's added relays when the account relay list arrives late", async () => {
    // A v1 draft: ADDED kept, ADDED_OFF added and then unticked.
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        editorState: { text: "draft text" },
        selectedRelays: [W1, ADDED],
        addedRelays: [ADDED, ADDED_OFF],
        timestamp: 1,
      }),
    );
    accountState.relays = undefined; // kind 10002 not loaded yet

    const view = render(<PostViewer />);
    await waitFor(() =>
      expect((screen.getByLabelText("note") as HTMLTextAreaElement).value).toBe(
        "draft text",
      ),
    );

    // The account's relay list lands after the draft was restored.
    accountState.relays = [
      { url: W1, read: true, write: true },
      { url: W2, read: true, write: true },
    ];
    view.rerender(<PostViewer />);

    await waitFor(() => expect(document.getElementById(W1)).toBeTruthy());
    expect(document.getElementById(ADDED)).toBeTruthy();
    expect(isChecked(ADDED)).toBe(true);
    expect(document.getElementById(ADDED_OFF)).toBeTruthy();
    expect(isChecked(ADDED_OFF)).toBe(false);
  });

  it("keeps added relays after Compose Another Post", async () => {
    render(<PostViewer />);
    fireEvent.change(screen.getByPlaceholderText("relay.example.com"), {
      target: { value: "added.example.com" },
    });
    fireEvent.click(screen.getByTitle("Add relay"));
    expect(isChecked(ADDED)).toBe(true);

    fireEvent.change(screen.getByLabelText("note"), {
      target: { value: "first post" },
    });
    fireEvent.click(screen.getByText("Publish"));
    await screen.findByTestId("published");

    fireEvent.click(screen.getByText("Compose Another Post"));
    expect(document.getElementById(ADDED)).toBeTruthy();
    expect(isChecked(ADDED)).toBe(true);
  });

  it("publishes to the effective selection", async () => {
    render(<PostViewer />);
    fireEvent.click(checkbox(W2));
    fireEvent.change(screen.getByLabelText("note"), {
      target: { value: "only one relay" },
    });
    fireEvent.click(screen.getByText("Publish"));
    await screen.findByTestId("published");
    expect(publishWithUpdates).toHaveBeenCalledTimes(1);
    const [event, relays] = (publishWithUpdates as Mock).mock.calls[0];
    expect(relays).toEqual([W1]);
    expect(event.content).toBe("only one relay");
    expect(event.pubkey).toBe(PUBKEY);
  });

  it("restores the default selection with Reset selection", async () => {
    render(<PostViewer />);
    fireEvent.click(checkbox(W1));
    expect(isChecked(W1)).toBe(false);
    fireEvent.click(screen.getByText("Reset selection"));
    expect(isChecked(W1)).toBe(true);
    expect(screen.queryByText("Reset selection")).toBeNull();
  });

  it("loads the other account's draft instead of carrying text across", async () => {
    const OTHER = "e".repeat(64);
    localStorage.setItem(
      `grimoire-post-draft-${OTHER}`,
      JSON.stringify({
        version: 2,
        editorState: { text: "other account draft" },
        overrides: {},
        addedRelays: [],
        excludedRecipients: [],
        timestamp: 1,
      }),
    );
    const view = render(<PostViewer />);
    fireEvent.change(screen.getByLabelText("note"), {
      target: { value: "mine" },
    });
    await pastDebounce();

    accountState.pubkey = OTHER;
    view.rerender(<PostViewer />);
    await waitFor(() =>
      expect((screen.getByLabelText("note") as HTMLTextAreaElement).value).toBe(
        "other account draft",
      ),
    );
    // The first account's draft is still its own.
    const mine = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    expect(mine.editorState).toEqual({ text: "mine" });
  });
});

// ---------------------------------------------------------------------------
// Tagged people and their inboxes
// ---------------------------------------------------------------------------

const ALICE_SK = generateSecretKey();
const ALICE = getPublicKey(ALICE_SK);
const BOB = getPublicKey(generateSecretKey());
const A1 = "wss://alice-one.example.com/";
const A2 = "wss://alice-two.example.com/";
const SHARED = "wss://shared.example.com/";
const mention = (pk: string) => `nostr:${nip19.npubEncode(pk)}`;

async function type(text: string) {
  fireEvent.change(screen.getByLabelText("note"), { target: { value: text } });
  // Past the 300ms recipient analysis debounce.
  await act(() => new Promise((r) => setTimeout(r, 400)));
}

const recipientRow = (pk: string) => screen.getByTestId(`recipient-${pk}`);

const publishedCall = () => {
  const [event, relays] = (publishWithUpdates as Mock).mock.calls[0];
  return {
    event: event as { tags: string[][]; content: string },
    relays: relays as string[],
  };
};

describe("PostViewer tagged people", () => {
  it("shows a mentioned person, looks up their inboxes and checks them", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);

    expect(recipientRow(ALICE).textContent).toContain("mentioned");
    expect(recipientRow(ALICE).textContent).toContain("finding inbox relays");
    expect(inboxCalls.map((c) => c.pubkey)).toEqual([ALICE]);

    await answer(ALICE, { status: "resolved", relays: [A1, W1], blocked: [] });
    expect(screen.getByText("Tagged people's inboxes")).toBeTruthy();
    expect(isChecked(A1)).toBe(true);
    // W1 is already the author's: one row, with Alice as a second reason.
    expect(document.querySelectorAll(`[id="${W1}"]`)).toHaveLength(1);
    expect(screen.getByText("also inbox of")).toBeTruthy();
    expect(recipientRow(ALICE).textContent).toContain("2 inbox relays");
  });

  it("says when a person has no relay list, or the lookup timed out", async () => {
    render(<PostViewer />);
    await type(`${mention(ALICE)} ${mention(BOB)}`);
    await answer(ALICE, { status: "no-list" });
    await answer(BOB, { status: "timeout" });
    expect(recipientRow(ALICE).textContent).toContain("no relay list found");
    expect(recipientRow(BOB).textContent).toContain("lookup timed out");
    expect(screen.queryByText("Tagged people's inboxes")).toBeNull();
  });

  it("keeps an unticked inbox relay off when the person's list changes later", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    fireEvent.click(checkbox(A1));
    expect(isChecked(A1)).toBe(false);

    // Alice publishes a new relay list while the composer is open.
    await act(async () => {
      eventStore.add(
        finalizeEvent(
          {
            kind: 10002,
            created_at: Math.floor(Date.now() / 1000) + 5,
            tags: [
              ["r", A1, "read"],
              ["r", A2, "read"],
            ],
            content: "",
          },
          ALICE_SK,
        ),
      );
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(inboxCalls.filter((c) => c.pubkey === ALICE)).toHaveLength(2);
    await answer(ALICE, { status: "resolved", relays: [A1, A2], blocked: [] });

    expect(isChecked(A1)).toBe(false);
    expect(isChecked(A2)).toBe(true);
  });

  it("ignores a lookup answer for someone no longer mentioned", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    await type("hi nobody");
    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    expect(document.getElementById(A1)).toBeNull();
    expect(screen.queryByTestId(`recipient-${ALICE}`)).toBeNull();

    // Re-adding the mention uses the answer already in hand: no new lookup.
    await type(`hi again ${mention(ALICE)}`);
    expect(inboxCalls).toHaveLength(1);
    expect(isChecked(A1)).toBe(true);
  });

  it("untags a person: no p tag, no inbox rows, a shared relay kept for others", async () => {
    render(<PostViewer />);
    await type(`${mention(ALICE)} and ${mention(BOB)}`);
    await answer(ALICE, {
      status: "resolved",
      relays: [A1, SHARED],
      blocked: [],
    });
    await answer(BOB, { status: "resolved", relays: [SHARED], blocked: [] });

    fireEvent.click(
      within(recipientRow(ALICE)).getByRole("button", { name: "Don't tag" }),
    );
    expect(recipientRow(ALICE).textContent).toContain("not tagged");
    expect(screen.getByText(/stay mentioned in the text/)).toBeTruthy();
    expect(document.getElementById(A1)).toBeNull();
    expect(isChecked(SHARED)).toBe(true);

    fireEvent.click(screen.getByText("Publish"));
    await screen.findByTestId("published");
    const { event, relays } = publishedCall();
    const pTags = event.tags.filter((t) => t[0] === "p").map((t) => t[1]);
    expect(pTags).toEqual([BOB]);
    // The mention itself stays in the note.
    expect(event.content).toContain(nip19.npubEncode(ALICE));
    expect(relays).toEqual([W1, W2, SHARED]);
  });

  it("keeps an untag across edits and draft restore until Tag again", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    fireEvent.click(
      within(recipientRow(ALICE)).getByRole("button", { name: "Don't tag" }),
    );
    // Editing (even removing and re-adding the mention) does not re-tag.
    await type("hi");
    await type(`hi ${mention(ALICE)} again`);
    expect(recipientRow(ALICE).textContent).toContain("not tagged");
    await pastDebounce();

    cleanup();
    render(<PostViewer />);
    await waitFor(() =>
      expect(screen.getByTestId(`recipient-${ALICE}`).textContent).toContain(
        "not tagged",
      ),
    );
    fireEvent.click(
      within(recipientRow(ALICE)).getByRole("button", { name: "Tag again" }),
    );
    // A fresh composer looks the person up again once they are tagged.
    await waitFor(() =>
      expect(inboxCalls.filter((c) => c.pubkey === ALICE)).toHaveLength(2),
    );
    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    await waitFor(() => expect(document.getElementById(A1)).toBeTruthy());
    expect(isChecked(A1)).toBe(true);
  });

  it("re-tagging brings inboxes back without overriding an explicit untick", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    await answer(ALICE, { status: "resolved", relays: [A1, A2], blocked: [] });
    fireEvent.click(checkbox(A2));
    fireEvent.click(
      within(recipientRow(ALICE)).getByRole("button", { name: "Don't tag" }),
    );
    fireEvent.click(
      within(recipientRow(ALICE)).getByRole("button", { name: "Tag again" }),
    );
    expect(isChecked(A1)).toBe(true);
    expect(isChecked(A2)).toBe(false);
  });

  it("waits for a lookup still running at Publish, then sends with it", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    fireEvent.click(screen.getByText("Publish"));
    expect(await screen.findByText("Finding inboxes…")).toBeTruthy();
    expect(publishWithUpdates).not.toHaveBeenCalled();

    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    await screen.findByTestId("published");
    expect(publishedCall().relays).toEqual([W1, W2, A1]);
    expect(toastMock.success).toHaveBeenCalledWith(
      "Published to all 3 relays",
      { description: "Accepted by an inbox relay of 1 person you tagged." },
    );
  });

  it("publishes after at most 3s without a lookup that never answers, and says so", async () => {
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    const started = Date.now();
    fireEvent.click(screen.getByText("Publish"));
    await screen.findByTestId("published", undefined, { timeout: 5000 });
    expect(Date.now() - started).toBeLessThan(4500);

    const { event, relays } = publishedCall();
    // Still tagged: the p tag does not depend on the lookup.
    expect(event.tags).toContainEqual(["p", ALICE]);
    expect(relays).toEqual([W1, W2]);
    expect(toastMock.success).toHaveBeenCalledWith(
      "Published to all 2 relays",
      {
        description:
          "Not sent to any inbox relay of 1 person (1 still being looked up).",
      },
    );

    // A late answer cannot add a row the note was never sent to.
    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    expect(document.getElementById(A1)).toBeNull();
  }, 10000);

  it("does not call an inbox relay's OK a delivery when it rejected the note", async () => {
    (publishWithUpdates as Mock).mockImplementation(
      (_e: unknown, relays: string[]) => ({
        updates$: new BehaviorSubject({ relay: relays[0], status: "success" }),
        result: Promise.resolve({
          ok: true,
          successful: relays.filter((r) => r !== A1),
          failed: [{ relay: A1, error: "blocked: not a member" }],
        }),
      }),
    );
    render(<PostViewer />);
    await type(`hi ${mention(ALICE)}`);
    await answer(ALICE, { status: "resolved", relays: [A1], blocked: [] });
    fireEvent.click(screen.getByText("Publish"));
    await screen.findByTestId("published");
    expect(toastMock.warning).toHaveBeenCalledWith(
      "Published to 2 of 3 relays",
      { description: "No inbox relay accepted it for 1 person." },
    );
  });
});
