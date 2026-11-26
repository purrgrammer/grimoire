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
} from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
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
