import {
  cloneElement,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ExternalLink,
  Send,
  Square,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { MessageResponse } from "./ai-elements/message";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { RichEditor, type RichEditorHandle } from "./editor/RichEditor";
import { useEmojiSearch } from "@/hooks/useEmojiSearch";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import {
  describeInferenceError,
  isAnyInferenceReachable,
  isInferenceAvailable,
  IPA_ID,
  onModelDownloadProgress,
  promptApiAvailability,
  resolveRequest,
  type ToolSupport,
} from "@/services/inference";
import { PROMPT_API_MODEL } from "@/services/prompt-api";
import { runToolLoop } from "@/services/tool-loop";
import type { NostrEvent } from "nostr-tools";

import type { InferenceMessage, Usage } from "@/types/inference";
import { formatTimestamp, useLocale } from "@/hooks/useLocale";
import { useLiveQuery } from "dexie-react-hooks";
import {
  loadStoredConversation,
  saveConversation,
} from "@/services/ai-conversations";
import {
  buildAiContext,
  buildMentionContext,
  GENERAL_SUGGESTIONS,
  MAX_KEPT_MENTIONS,
  toolsSystem,
  type AiTarget,
  type MentionContext,
} from "@/lib/ai-context";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";
import { AgentPanel } from "./ai/AgentPanel";
import { HEX_NAME, HexAvatar } from "./ai/Hex";
import { Shimmer, SHIMMER_DURATION } from "./ai-elements/shimmer";
import { CommandChips } from "./ai/CommandChips";
import { BackendSelect } from "./ai/BackendSelect";
import { ConversationIndex } from "./ai/ConversationIndex";
import { ModelDownload } from "./ai/ModelDownload";
import { ReplyCodeBlock } from "./ai/ReplyCodeBlock";
import { COMMAND_FENCE } from "@/lib/ai-commands";
import { createWindowExecutor } from "@/lib/ai-window-tool";
import { AI_TOOLS, createToolExecutors } from "@/lib/ai-registry";
import { TurnSteps } from "./ai/TurnSteps";
import type { ToolRun } from "@/types/tool-part";
import { useAccount } from "@/hooks/useAccount";
import { useSettings } from "@/hooks/useSettings";
import { ProviderLogo, providerFromModel } from "./ai/ProviderLogo";
import { useAddWindow } from "@/core/state";
import {
  hasEventEmbed,
  nostrRefTarget,
  splitNostrRefs,
  type NostrRefTarget,
} from "@/lib/open-nostr-ref";
import { splitNipRefs } from "@/lib/nip-refs";
import { getNIPInfo } from "@/lib/nip-icons";
import { UserName } from "./nostr/UserName";
import { RichText } from "./nostr/RichText";
import { cn } from "@/lib/utils";
import { EmbeddedEvent } from "./nostr/EmbeddedEvent";
import { MediaEmbed } from "./nostr/MediaEmbed";

interface AiViewerProps {
  /** Prompt from the command line. Sent once, when nothing is stored yet. */
  prompt?: string;
  system?: string;
  /** Key for persisted turns. Without it the conversation is ephemeral. */
  windowId?: string;
  /** Adopt an existing stored conversation instead of starting a new one. */
  conversation?: string;
  /** Object the question is about. Its own data becomes the system prompt. */
  target?: AiTarget;
}

/**
 * Render markdown text, showing every bech32 entity as the thing it names: a
 * person as `UserName`, an event through the feed renderer, anything else as a
 * link. A model that mentions an npub should read like a note that does.
 */
function LinkedText({
  children,
  onOpen,
  onOpenNip,
}: {
  children?: ReactNode;
  onOpen: (target: NostrRefTarget, label: string) => void;
  onOpenNip: (number: string) => void;
}) {
  if (typeof children !== "string") return <>{children}</>;

  const segments = splitNostrRefs(children);
  if (segments.length === 1 && !segments[0].target) {
    return <NipText onOpen={onOpenNip}>{children}</NipText>;
  }

  return (
    <>
      {segments.map((segment, index) => {
        const key = `${index}-${segment.text}`;
        const target = segment.target;

        if (!target) {
          return (
            <span key={`${index}-plain`}>
              <NipText onOpen={onOpenNip}>{segment.text}</NipText>
            </span>
          );
        }

        // A person renders as a person: display name, member badge, flame.
        // UserName opens the profile itself.
        if (target.pubkey) {
          return (
            <UserName
              isMention
              key={key}
              pubkey={target.pubkey}
              relayHints={target.relays}
            />
          );
        }

        // An event renders through the same registry the feed uses, so a
        // mentioned note looks like a note and a mentioned NIP like a NIP.
        if (target.eventPointer || target.addressPointer) {
          return (
            <EmbeddedEvent
              addressPointer={target.addressPointer}
              eventPointer={target.eventPointer}
              key={key}
              onOpen={() => onOpen(target, segment.text)}
            />
          );
        }

        return (
          <button
            className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
            key={key}
            onClick={() => onOpen(target, segment.text)}
            title={segment.text}
            type="button"
          >
            {segment.text.slice(0, 12)}…
          </button>
        );
      })}
    </>
  );
}

/**
 * `NIP-01` in a reply, as a link to the NIP.
 *
 * A spec number is the most common reference in an answer about the protocol,
 * and a model writes it as prose rather than as a `nostr:` entity — so it landed
 * as dead text next to mentions that were live. Styled like the same reference
 * inside a note, since that is what it is.
 */
function NipText({
  children,
  onOpen,
}: {
  children: string;
  onOpen: (number: string) => void;
}) {
  const segments = splitNipRefs(children);
  if (segments.length === 1 && !segments[0].number) return <>{children}</>;

  return (
    <>
      {segments.map((segment, index) =>
        segment.number ? (
          <button
            className="cursor-crosshair text-muted-foreground underline decoration-dotted hover:text-foreground"
            key={`${index}-${segment.text}`}
            onClick={() => onOpen(segment.number!)}
            title={
              getNIPInfo(segment.number)?.description ??
              `View NIP-${segment.number}`
            }
            type="button"
          >
            {segment.text}
          </button>
        ) : (
          <Fragment key={`${index}-plain`}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Questions already asked, newest first — the order mention budget is spent in. */
function userTurnsNewestFirst(turns: Turn[]): string[] {
  return turns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .reverse();
}

/** A turn as rendered. `pending` marks the assistant turn currently streaming. */
interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Unix seconds, for the row's relative time. */
  at?: number;
  /** Kept for turns stored before reasoning was split per round. */
  reasoning?: string;
  /** Each round's reasoning, so it renders around the calls it explains. */
  reasoningRounds?: string[];
  pending?: boolean;
  /** From the `done` chunk. The model is the extension's choice, not ours. */
  model?: string;
  usage?: Usage;
  toolRuns?: ToolRun[];
  /** Nostr objects this turn named, so a reopened window can render them. */
  mentions?: { events?: NostrEvent[]; pubkeys?: string[] };
}

/**
 * The mentions worth keeping on a turn, as the stored shape.
 *
 * Only what resolved: a pubkey with no kind 0 is still worth keeping, because
 * the profile may exist by the time the conversation is reopened, but an empty
 * pair of arrays is not worth a row.
 */
function attachment(context: MentionContext): { mentions?: Turn["mentions"] } {
  const mentions = {
    ...(context.events.length ? { events: context.events } : {}),
    ...(context.pubkeys.length ? { pubkeys: context.pubkeys } : {}),
  };
  return Object.keys(mentions).length > 0 ? { mentions } : {};
}

/**
 * Source of a ```grimoire fence, or null for any other code block. Markdown
 * renders a fence as `<pre><code class="language-grimoire">…`, so the language
 * lives on the child.
 */
function fencedBlock(
  children: ReactNode,
): { language?: string; code: string } | null {
  if (!isValidElement(children)) return null;
  const props = children.props as {
    className?: unknown;
    children?: unknown;
  };
  if (typeof props.children !== "string") return null;
  const className =
    typeof props.className === "string" ? props.className : undefined;
  const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
  return { code: props.children, ...(language ? { language } : {}) };
}

/** True when any string leaf holds a reference that renders as a block embed. */
function containsEventEmbed(children: ReactNode): boolean {
  if (typeof children === "string") return hasEventEmbed(children);
  if (Array.isArray(children)) return children.some(containsEventEmbed);
  if (isValidElement(children)) {
    return containsEventEmbed(
      (children.props as { children?: ReactNode }).children,
    );
  }
  return false;
}

/** A reference inside these is text on purpose, so it stays text. */
const LITERAL_TAGS = new Set(["code", "pre"]);

/** True when a string leaf holds any reference grimoire can resolve. */
function containsNostrRef(children: ReactNode): boolean {
  if (typeof children === "string") {
    return splitNostrRefs(children).some((segment) => segment.target);
  }
  if (Array.isArray(children)) return children.some(containsNostrRef);
  if (isValidElement(children)) {
    return containsNostrRef(
      (children.props as { children?: ReactNode }).children,
    );
  }
  return false;
}

/**
 * Apply LinkedText to the string leaves of a markdown element's children.
 *
 * It walks into elements, not just arrays: a `nostr:` reference lands inside
 * whatever markdown wrapped it — bold, a link, a heading — and stopping at the
 * first element left those rendering as raw bech32.
 */
function withLinks(
  children: ReactNode,
  onOpen: (target: NostrRefTarget, label: string) => void,
  onOpenNip: (number: string) => void,
): ReactNode {
  if (typeof children === "string") {
    return (
      <LinkedText onOpen={onOpen} onOpenNip={onOpenNip}>
        {children}
      </LinkedText>
    );
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => (
      <Fragment key={index}>{withLinks(child, onOpen, onOpenNip)}</Fragment>
    ));
  }
  if (isValidElement(children)) {
    if (typeof children.type === "string" && LITERAL_TAGS.has(children.type)) {
      return children;
    }
    const inner = (children.props as { children?: ReactNode }).children;
    if (inner === undefined) return children;
    // An autolinked reference loses its anchor: what replaces it is a button or
    // an embed, and neither is valid inside an <a>. A NIP inside a real link is
    // left alone — the author linked it somewhere on purpose.
    if (children.type === "a" && containsNostrRef(inner)) {
      return withLinks(inner, onOpen, onOpenNip);
    }
    if (children.type === "a") return children;
    return cloneElement(
      children as ReactElement<{ children?: ReactNode }>,
      undefined,
      withLinks(inner, onOpen, onOpenNip),
    );
  }
  return children;
}

/**
 * Model and token counts from the `done` chunk. No cost: the spec leaves
 * pricing metadata undefined, so any figure here would be invented.
 */
function TurnUsage({
  locale,
  model,
  usage,
}: {
  locale: string;
  model?: string;
  usage?: Usage;
}) {
  if (!model && !usage) return null;
  // Compact so a long model id and both counts fit one line in a narrow window.
  const format = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format;

  // `anthropic/claude-haiku-4.5` → provider mark plus `claude-haiku-4.5`.
  const provider = providerFromModel(model);
  const modelName = provider ? model!.slice(provider.length + 1) : model;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
      {model && (
        <span className="flex items-center gap-1" title={model}>
          <ProviderLogo className="size-2.5" provider={provider} />
          <span className="font-mono">{modelName}</span>
        </span>
      )}
      {usage?.inputTokens !== undefined && (
        <span className="flex items-center gap-0.5" title="Input tokens">
          <ArrowUp className="size-2.5" />
          {format(usage.inputTokens)}
        </span>
      )}
      {usage?.outputTokens !== undefined && (
        <span className="flex items-center gap-0.5" title="Output tokens">
          <ArrowDown className="size-2.5" />
          {format(usage.outputTokens)}
        </span>
      )}
    </div>
  );
}

export default function AiViewer({
  conversation,
  prompt,
  system,
  target,
  windowId,
}: AiViewerProps) {
  // An adopted conversation keeps its original key, so reopening it from the
  // index reads and writes the same row.
  const storageId = conversation ?? windowId;
  // Nothing to ground on and nothing asked: this window is the index.
  const isBare = !target && !prompt && !conversation && !system;
  const { locale } = useLocale();
  const addWindow = useAddWindow();
  const { pubkey } = useAccount();

  // The target's own data — event JSON, kind registry entry, cached NIP text —
  // becomes the system prompt. Resolved through a live query so it picks up an
  // event or NIP that arrives after the window opens.
  // Always a context: without a target it is Hex's own instructions plus the
  // command catalogue, which every window needs.
  // Turns live in Dexie so a reload restores them with the window. `stored`
  // seeds the first render; after that local state owns them, so a streaming
  // reply is never fighting a query result.
  const row = useLiveQuery(
    () =>
      storageId
        ? loadStoredConversation(storageId)
        : Promise.resolve({ turns: [] as Turn[] }),
    [storageId],
  );
  const stored = row?.turns;

  // What this window is about: the command's own target, or the one the stored
  // conversation was started with. Reopening from the index passes only an id,
  // so without the stored half a conversation about an event came back with no
  // event in it and no grounding in its prompt.
  const subject: AiTarget | undefined = target ?? row?.target;
  const context = useLiveQuery(
    () => buildAiContext(subject),
    [subject?.type, subject?.value],
  );
  const [local, setLocal] = useState<Turn[] | null>(null);
  // Memoized so `send`, which closes over it, is not rebuilt every render.
  const turns: Turn[] = useMemo(() => local ?? stored ?? [], [local, stored]);
  // The index is what a bare window shows until something is asked in it.
  const showIndex = isBare && turns.length === 0;
  const setTurns = useCallback(
    (update: (previous: Turn[]) => Turn[]) => {
      setLocal((previous) => update(previous ?? stored ?? []));
    },
    [stored],
  );
  const [streaming, setStreaming] = useState(false);
  // The exact system prompt of the last send, so the disclosure shows what was
  // sent rather than what would be sent now.
  const [sentSystem, setSentSystem] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const editorRef = useRef<RichEditorHandle>(null);
  const { searchProfiles } = useProfileSearch();
  const { searchEmojis } = useEmojiSearch();
  /** Set when this pane is going away, so its own abort is not reported. */
  const tornDown = useRef(false);
  // Where answers come from. A global preference rather than per-window: it is a
  // statement about this machine (what may leave it, what is paid for), not about
  // one conversation.
  const { settings, updateSetting } = useSettings();
  // `use$` has no value on the first frame; the default is what settings would
  // have said anyway.
  const backend = settings?.inference.backend ?? "auto";

  // Availability is read once: an injector that appears later is picked up on
  // the next send, which throws `unavailable` with the same message.
  // `isAnyInferenceReachable` also counts the browser's own model, so a user
  // with no extension is not told nothing can answer.
  const available = isAnyInferenceReachable();
  const injected = isInferenceAvailable();
  /** Bytes (or fraction) of the on-device model downloaded, while it is. */
  const [download, setDownload] = useState<number>();
  /**
   * The on-device model is not ready and this turn is waiting for it.
   *
   * Separate from `download`, which only exists once Chrome reports a number —
   * and it reports nothing for a download that began before this page loaded, so
   * a turn can sit inside `create()` for minutes with no progress event at all.
   */
  const [awaitingModel, setAwaitingModel] = useState(false);

  // Before the first send, mentions are unknown, so show the grounding that is
  // already decided. After, show exactly what went out.
  const disclosedSystem = sentSystem ?? system ?? context?.system;

  // A window grounded on an event previews it, so the conversation shows what
  // it is about rather than only naming it in a hidden prompt.
  const targetValue = subject?.type === "event" ? subject.value : undefined;
  const targetRef = useMemo(() => {
    if (!targetValue) return undefined;
    const ref = nostrRefTarget(targetValue);
    if (!ref) return undefined;
    if (ref.eventPointer || ref.addressPointer) return ref;
    // An npub or nprofile: preview the person through their kind 0, so a
    // profile question shows the profile the same way an event question shows
    // the event — the metadata renderer already exists.
    if (ref.pubkey) {
      return {
        ...ref,
        addressPointer: {
          kind: 0,
          pubkey: ref.pubkey,
          identifier: "",
          ...(ref.relays ? { relays: ref.relays } : {}),
        },
      };
    }
    return undefined;
  }, [targetValue]);

  // Which request function to use, and whether it takes tools. Standard first;
  // the experimental namespace only to gain tool calling.
  const toolSupport: ToolSupport = useMemo(
    // Keyed on the preference too: forcing the on-device model takes tools away,
    // and a panel that kept claiming them would be lying. `available` is read
    // rather than only listed, so an injector appearing late re-keys this.
    () =>
      available || isAnyInferenceReachable()
        ? resolveRequest(backend).tools
        : "none",
    [available, backend],
  );
  const toolsEnabled = toolSupport !== "none";

  // Said once, where the choice was made: the selected backend is not the one
  // answering. Not an error — nothing failed — so it is a note, not the error row.
  const substitution = useMemo(() => {
    if (!available) return undefined;
    const resolved = resolveRequest(backend);
    if (!resolved.substituted) return undefined;
    return resolved.substituted === IPA_ID
      ? "This browser has no on-device model, so your extension is answering."
      : "No extension found, so the browser's own model is answering.";
  }, [available, backend]);

  // The model that answered most recently, for the agent header. On the
  // on-device path nothing has answered yet but the model is already known.
  const lastModel = useMemo(
    () =>
      [...turns].reverse().find((turn) => turn.model !== undefined)?.model ??
      (injected ? undefined : PROMPT_API_MODEL),
    [injected, turns],
  );

  // `grimoire.window` needs the window state, so it is injected here; the
  // read-only executors are pure and live in the lib. The executor itself is
  // shared with the WebMCP surface — both must refuse the same commands.
  const executors = useMemo(
    () =>
      createToolExecutors({
        "grimoire.window": createWindowExecutor(addWindow, pubkey),
      }),
    [addWindow, pubkey],
  );

  // Markdown element overrides for MessageResponse. Memoized because a new
  // object each render would defeat its memo and re-parse the whole reply.
  const markdownComponents = useMemo(() => {
    const onOpen = (target: NostrRefTarget, label: string) =>
      addWindow(target.appId, target.props, `open ${label}`);
    const onOpenNip = (number: string) =>
      addWindow(
        "nip",
        { number },
        `nip ${number}`,
        `NIP ${number}${getNIPInfo(number)?.name ? ` - ${getNIPInfo(number)?.name}` : ""}`,
      );
    return {
      // A ```grimoire fence is a command proposal, not code to read. Render it
      // as buttons; anything else stays a normal code block.
      pre: ({ children, ...rest }: { children?: ReactNode }) => {
        const block = fencedBlock(children);
        if (block?.language === COMMAND_FENCE) {
          return <CommandChips block={block.code} />;
        }
        // Everything else goes through grimoire's code component, so it is
        // highlighted and copyable like code anywhere else in the app.
        return block ? (
          <ReplyCodeBlock code={block.code} language={block.language} />
        ) : (
          <pre className="max-w-full overflow-x-auto" {...rest}>
            {children}
          </pre>
        );
      },
      // An event embed is a block, and a <div> inside a <p> is invalid HTML
      // that browsers repair by splitting the paragraph. Swap the tag instead.
      p: ({ children }: { children?: ReactNode }) =>
        containsEventEmbed(children) ? (
          <div className="mb-4">{withLinks(children, onOpen, onOpenNip)}</div>
        ) : (
          <p>{withLinks(children, onOpen, onOpenNip)}</p>
        ),
      li: ({ children }: { children?: ReactNode }) => (
        <li>{withLinks(children, onOpen, onOpenNip)}</li>
      ),
      // A reply can carry an image two ways: a URL a model quoted from an event
      // it read, or a `data:` URI it produced. Both go through the same embed
      // every note uses — zoomable, bounded, and with grimoire's own failure
      // state rather than a browser broken-image icon.
      img: ({ alt, src }: { alt?: string; src?: unknown }) =>
        typeof src === "string" && src ? (
          <MediaEmbed
            alt={alt}
            className="my-2 max-w-full"
            preset="inline"
            type="image"
            url={src}
          />
        ) : null,
      // Every other place a reference can land. Markdown only routes the tag it
      // renders through `components`, so a heading or a table cell that was not
      // listed here showed raw bech32 — the model puts npubs in both.
      ...Object.fromEntries(
        (
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "blockquote",
            "td",
            "th",
          ] as const
        ).map((tag) => [
          tag,
          ({ children, ...rest }: { children?: ReactNode }) => {
            const Tag = tag;
            return (
              <Tag {...rest}>{withLinks(children, onOpen, onOpenNip)}</Tag>
            );
          },
        ]),
      ),
    };
  }, [addWindow]);

  const send = useCallback(
    async (text: string) => {
      // The conversation this turn is being added to, read rather than assumed.
      //
      // `turns` is `local ?? stored ?? []`, and `stored` is a live query: a
      // window opened with `--conversation <id>` renders — and autofocuses its
      // composer — before that query resolves, so a fast first message used the
      // empty list as its base and saved two turns over the whole history.
      // Sending is rare and this read is local, so it is always taken fresh.
      // `Turn` is the stored shape plus `pending`, which only ever exists in
      // state — a stored turn is by definition settled.
      const base: Turn[] =
        local ??
        (storageId ? (await loadStoredConversation(storageId)).turns : []);
      const priorMessages: InferenceMessage[] = base
        .filter((turn) => !turn.pending)
        .map((turn) =>
          turn.role === "user"
            ? { role: "user" as const, content: turn.content }
            : {
                role: "assistant" as const,
                content: turn.content,
                ...(turn.reasoning ? { reasoning: turn.reasoning } : {}),
              },
        );

      setError(null);
      const at = Math.floor(Date.now() / 1000);
      setLocal(() => [
        ...base,
        { role: "user", content: text, at },
        { role: "assistant", content: "", pending: true, at },
      ]);
      setStreaming(true);

      const controller = new AbortController();
      controllerRef.current = controller;

      // Resolve references named in the conversation — after the turn is on
      // screen, because this can wait on a relay. An explicit --system wins over
      // the target's context; mentions are additive to whichever applies.
      //
      // Every user turn, newest first, not only the newest: someone who attaches
      // a profile and asks a follow-up two turns later is still asking about
      // that person, and the metadata would otherwise have fallen out of the
      // prompt. `buildMentionContext` caps and dedupes, so the current message
      // wins the budget.
      const mentions = await buildMentionContext(
        [text, ...userTurnsNewestFirst(base)].join("\n\n"),
      );
      // What this message named travels with it, so the reopened conversation
      // renders the person and the note rather than the bech32 for them.
      // Resolved a second time rather than filtered out of the above: the first
      // call put everything in the EventStore, so this one is local.
      const attached = await buildMentionContext(text);
      const systemPrompt =
        [system ?? context?.system, toolsSystem(toolsEnabled), mentions.system]
          .filter(Boolean)
          .join("\n\n") || undefined;
      setSentSystem(systemPrompt);
      const history: InferenceMessage[] = [
        ...(systemPrompt
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
        ...priorMessages,
        { role: "user", content: text },
      ];

      // Accumulate off-state and flush on a frame so a token-per-render
      // stream does not thrash the tree.
      let content = "";
      let reasoningRounds: string[] = [];
      let model: string | undefined;
      let usage: Usage | undefined;
      let queued = false;
      const flush = () => {
        queued = false;
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 && turn.pending
              ? {
                  ...turn,
                  content,
                  ...(reasoningRounds.length ? { reasoningRounds } : {}),
                }
              : turn,
          ),
        );
      };
      const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(flush);
      };
      // Tool state changes are rare and worth showing immediately, so they
      // bypass the frame-batching that deltas need.
      const flushToolRuns = (runs: ToolRun[]) => {
        setTurns((previous) =>
          previous.map((turn, index) =>
            index === previous.length - 1 && turn.pending
              ? { ...turn, toolRuns: runs.map((run) => ({ ...run })) }
              : turn,
          ),
        );
      };

      // The on-device model downloads on first use, which is large enough that
      // a silent wait reads as a hang.
      onModelDownloadProgress(setDownload);
      // Said before the request, not on the first progress event: opening a model
      // that is still arriving blocks until it has, and Chrome does not report
      // progress for a download it did not start here.
      if (resolveRequest(backend).onDevice) {
        void promptApiAvailability().then((state) => {
          if (state !== "available") setAwaitingModel(true);
        });
      }

      try {
        const loop = await runToolLoop({
          executors,
          messages: history,
          // Snapshots, not deltas: the loop drops the preamble a tool round
          // emits, so it owns the text and this only mirrors it.
          onDelta: (text) => {
            content = text;
            schedule();
          },
          onReasoningDelta: (rounds) => {
            reasoningRounds = rounds;
            schedule();
          },
          onToolRuns: flushToolRuns,
          request: resolveRequest(backend).request,
          signal: controller.signal,
          ...(toolsEnabled ? { tools: AI_TOOLS } : {}),
        });
        content = loop.content;
        reasoningRounds = loop.reasoningRounds;
        model = loop.model;
        usage = loop.usage;
        const toolRuns = loop.toolRuns;

        // Rebuild from the turns we started with so earlier model and usage
        // survive; the placeholder is replaced, not patched.
        // The reply's own references, kept the same way: Hex answers by quoting
        // npubs and nevents, and those are exactly what a reopened conversation
        // could no longer render. Everything it quotes was resolved during the
        // turn, so this reads the EventStore rather than the network.
        const replied = await buildMentionContext(content, {
          limit: MAX_KEPT_MENTIONS,
        });

        const settled: Turn[] = [
          ...base.filter((turn) => !turn.pending),
          { role: "user", content: text, at, ...attachment(attached) },
          {
            role: "assistant",
            at: Math.floor(Date.now() / 1000),
            content,
            ...attachment(replied),
            ...(reasoningRounds.some(Boolean) ? { reasoningRounds } : {}),
            ...(model ? { model } : {}),
            ...(usage ? { usage } : {}),
            ...(toolRuns.length ? { toolRuns } : {}),
          },
        ];
        setLocal(settled);
        // Save once the turn is settled, never mid-stream — a partial reply is
        // not worth a write per frame.
        // The subject travels with the turns: an index row reopens knowing what
        // it was about.
        if (storageId) void saveConversation(storageId, settled, subject);
      } catch (caught) {
        // A turn the window itself cancelled is not an error worth reporting:
        // the request went away because this pane did, and in dev a Fast
        // Refresh runs the same cleanup, which read as "Request cancelled."
        // out of nowhere.
        if (!tornDown.current) setError(describeInferenceError(caught));
        // Drop the empty pending turn; the error is shown instead.
        setTurns((previous) =>
          previous.filter(
            (turn, index) =>
              !(index === previous.length - 1 && turn.pending && !turn.content),
          ),
        );
      } finally {
        controllerRef.current = null;
        setStreaming(false);
        onModelDownloadProgress(undefined);
        setDownload(undefined);
        setAwaitingModel(false);
      }
    },
    [
      backend,
      context?.system,
      executors,
      local,
      setTurns,
      storageId,
      subject,
      system,
      toolsEnabled,
    ],
  );

  // Closing the window must cancel in-flight provider work — a stream nobody
  // will read is still being paid for.
  useEffect(
    () => () => {
      tornDown.current = true;
      controllerRef.current?.abort();
    },
    [],
  );

  /**
   * Send the command-line prompt once. Guarded on the *stored* conversation
   * rather than a ref alone: windows are restored from localStorage, and the
   * only durable proof this prompt was already answered is that its turns came
   * back. `stored === undefined` means the query has not resolved yet.
   */
  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current || !prompt || !available || stored === undefined) {
      return;
    }
    autoSent.current = true;
    if (stored.length > 0 || turns.length > 0) return;
    // Only an injector answers unprompted. Opening the on-device model can
    // start a download, which the browser only allows from a user gesture, so
    // the prompt waits in the composer for the click that qualifies — including
    // when an extension exists and the user chose on-device anyway.
    if (resolveRequest(backend).onDevice) {
      editorRef.current?.insertText(prompt);
      return;
    }
    void send(prompt);
  }, [available, backend, prompt, send, stored, turns.length]);

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <HexAvatar className="size-8" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{HEX_NAME} needs a provider</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Inference comes from an extension that injects{" "}
            <code className="text-xs">window.inference</code>. It keeps your API
            keys — grimoire never sees them, and asks nothing of them. This
            browser has no built-in model to fall back to either.
          </p>
          <a
            className="inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2 hover:text-primary/80"
            href="https://chromewebstore.google.com/detail/inference-bridge/ekjldffogogadhfhgkibgkfdhhikfamd"
            rel="noreferrer noopener"
            target="_blank"
          >
            Get Inference Bridge
            <ExternalLink className="size-3" />
          </a>
          <p className="text-xs text-muted-foreground">
            Reopen this window once it is installed.
          </p>
        </div>
      </div>
    );
  }

  // The composer leads on the index — a bare window is a place to start a
  // conversation — and trails a conversation, where it is a reply box.
  // `text-left`: the landing page centres its column, and centred text puts the
  // caret in the middle of an empty box.
  const composer = (
    <div
      className={cn("px-2 py-1 text-left", showIndex ? "w-full" : "border-t")}
    >
      {/* On the index the composer sits in the centred column with the greeting
          and the list, so the width is the column's — and it wears the dotted
          border grimoire puts around anything you fill in yourself, rather than
          floating unmarked in the middle of the page. */}
      <div
        className={cn(
          "flex items-end gap-1.5",
          showIndex && "rounded border border-dotted border-muted px-2 py-1",
        )}
      >
        {/* The same editor the chat and post windows use: `@` completes to a
            profile and a pasted nostr entity becomes a preview, so a question
            can name a person or an event the way the rest of grimoire does —
            and what it serializes is `nostr:` URIs, which is exactly what the
            prompt builder resolves and the reply renderer links. */}
        <RichEditor
          // The window opens to be typed in — a palette command that lands on a
          // box you then have to click is a wasted step.
          autoFocus
          className="min-w-0 flex-1"
          maxHeight={160}
          // Three lines on the landing page, where the box is the page and a
          // one-line slot reads as a search field; one line as a reply box,
          // where the conversation above it is what matters.
          minHeight={showIndex ? 64 : 28}
          onSubmit={(content) => {
            const text = content.trim();
            if (!text || streaming) return;
            editorRef.current?.clear();
            void send(text);
          }}
          placeholder={`Ask ${HEX_NAME}...`}
          ref={editorRef}
          searchEmojis={searchEmojis}
          searchProfiles={searchProfiles}
        />
        {streaming ? (
          <Button
            className="h-7 flex-shrink-0 px-2 text-xs"
            onClick={() => controllerRef.current?.abort()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Square className="size-3" />
            Stop
          </Button>
        ) : (
          <Button
            className="h-7 flex-shrink-0 px-2 text-xs"
            onClick={() => editorRef.current?.submit()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Send className="size-3" />
            Send
          </Button>
        )}
      </div>
      {/* The shortcut has always worked; nothing said so, and a three-line box
          invites Enter. Only on the landing page — a reply box sits under a
          conversation, which is what should be read there. */}
      {showIndex && !streaming && (
        <div className="flex items-center gap-1 pt-1 pr-1 text-xs text-muted-foreground">
          {/* Where the answer comes from, next to the box you ask in. */}
          <BackendSelect
            onChange={(next) => updateSetting("inference", "backend", next)}
            value={backend}
          />
          <span className="flex-1" />
          {/* `Ctrl`, not the platform modifier: both are bound, and this is the
              one that works everywhere and the one people try first. */}
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
          <span>to send, Enter for a new line</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/*
        `min-h-0` is load-bearing: a flex item defaults to min-height:auto, so
        Conversation would grow past the pane and the window's own overflow-auto
        would scroll instead. StickToBottom's scroller is height:100% of this
        element, so an unbounded height means it never scrolls — and never
        follows the stream.
      */}
      {/* `initial={false}` before the first turn: sticking to the bottom of a
          window where nothing has been said scrolls past the top of the event
          the question is about. Once there are turns, the newest is the point. */}
      <Conversation
        className="min-h-0"
        initial={turns.length > 0 ? "smooth" : false}
      >
        {/* The empty state centers itself in `size-full`, so the content box
            has to fill the pane — its default height is its content. */}
        <ConversationContent className={turns.length === 0 ? "h-full" : ""}>
          {/* What the model was actually told, before anything the user typed. */}
          {/* Configuration belongs to a conversation, not to the index: the
              bare page is a list, and nothing has been sent from it yet.
              Collapsed to its header, so the subject below it stays on the
              first screen. */}
          {!showIndex && (
            <AgentPanel
              className="shrink-0"
              instructions={disclosedSystem}
              model={lastModel}
              toolSupport={toolSupport}
              tools={AI_TOOLS}
            />
          )}
          {/* The event under discussion, rendered as itself — the question is
              about this, so it belongs in the conversation, not just the prompt.
              `shrink-0`, because the content box is a flex column that is
              `h-full` before the first turn: a shrinkable child gets squeezed to
              a sliver of the note it is supposed to show. */}
          {targetRef && (
            <EmbeddedEvent
              className="my-4 shrink-0 overflow-hidden rounded border border-muted"
              addressPointer={targetRef.addressPointer}
              eventPointer={targetRef.eventPointer}
            />
          )}
          {turns.length === 0 ? (
            // A bare `ai` window is a landing page: who is asking, three things
            // worth asking, the box to ask in, and what was asked before —
            // centred and bounded, because a wide tile would otherwise spread
            // four words of title across a metre of screen.
            showIndex ? (
              <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-2 py-8 text-center">
                <h1 className="flex flex-wrap items-baseline justify-center gap-2 text-3xl font-semibold tracking-tight">
                  <span>GM{pubkey ? "," : ""}</span>
                  {/* The user's own name, from their kind 0 — the same
                      component that names them anywhere else in grimoire. */}
                  {pubkey && (
                    <UserName className="font-semibold" pubkey={pubkey} />
                  )}
                </h1>
                {/* Three openers. Clicking sends; nothing fires on its own. */}
                <Suggestions className="justify-center">
                  {GENERAL_SUGGESTIONS.slice(0, 3).map((suggestion) => (
                    <Suggestion
                      key={suggestion}
                      onClick={(text) => {
                        if (streaming) return;
                        void send(text);
                      }}
                      suggestion={suggestion}
                    />
                  ))}
                </Suggestions>
                {composer}
                <ConversationIndex currentWindowId={storageId} />
              </div>
            ) : (
              // `h-auto flex-1`: takes the space left over rather than a full
              // height of its own, so it centers in what remains beside the
              // event above it instead of pushing it out of the pane.
              <ConversationEmptyState className="h-auto flex-1">
                {/* The event above says what this is about better than a line
                    naming its kind, so with a preview the copy is only the
                    openers. Without one, say what the window is. */}
                {!targetRef && (
                  <>
                    <HexAvatar className="size-8" />
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium">
                        {context?.label
                          ? `Ask ${HEX_NAME} about ${context.label}`
                          : `Ask ${HEX_NAME}`}
                      </h3>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        {context?.label
                          ? "Grounded in the local copy — no data leaves except the prompt."
                          : injected
                            ? "Your extension picks the provider and model."
                            : "No extension found, so this runs on the browser's own model — nothing leaves the machine. The first answer downloads it."}
                      </p>
                    </div>
                  </>
                )}
                {/* Openers, tailored to whatever this window is grounded in.
                    Clicking sends; nothing fires on its own. */}
                <Suggestions className="justify-center pt-2">
                  {/* Three: openers are a nudge, and five of them read as a
                      menu the user has to work through. */}
                  {(context?.suggestions ?? GENERAL_SUGGESTIONS)
                    .slice(0, 3)
                    .map((suggestion) => (
                      <Suggestion
                        key={suggestion}
                        onClick={(text) => {
                          if (streaming) return;
                          void send(text);
                        }}
                        suggestion={suggestion}
                      />
                    ))}
                </Suggestions>
              </ConversationEmptyState>
            )
          ) : (
            // A turn reads like every other message in grimoire: speaker,
            // relative time, content, separated by a rule — not a bubble.
            turns.map((turn, index) => (
              <div
                className={cn(
                  "flex flex-col gap-1 px-3 py-2",
                  // A question and its answer are one exchange; only the answer
                  // closes it with a rule.
                  turn.role === "assistant" && "border-b border-border/50",
                  "last:border-0",
                )}
                key={index}
              >
                <div className="flex flex-row items-baseline justify-between gap-2">
                  <div className="flex min-w-0 flex-row items-baseline gap-2">
                    {turn.role === "assistant" ? (
                      <>
                        <HexAvatar
                          className="self-center"
                          face={turn.pending ? "working" : "idle"}
                        />
                        {turn.pending ? (
                          // Shimmer while he is thinking, so a long first token
                          // reads as thought rather than a stall.
                          <Shimmer
                            as="span"
                            className="font-medium"
                            duration={SHIMMER_DURATION}
                          >
                            {HEX_NAME}
                          </Shimmer>
                        ) : (
                          <span className="font-medium text-accent">
                            {HEX_NAME}
                          </span>
                        )}
                        {/* The same marker an automated account wears in a
                            member list: whoever is speaking here is a model. */}
                        <Bot
                          aria-label="Automated account"
                          className="size-3 shrink-0 self-center text-muted-foreground"
                        />
                      </>
                    ) : pubkey ? (
                      <UserName className="font-medium" pubkey={pubkey} />
                    ) : (
                      <span className="font-medium">you</span>
                    )}
                    {turn.at !== undefined && !turn.pending && (
                      <span
                        className="shrink-0 whitespace-nowrap text-xs text-muted-foreground"
                        title={formatTimestamp(turn.at, "absolute", locale)}
                      >
                        {formatTimestamp(turn.at, "relative", locale)}
                      </span>
                    )}
                  </div>
                  {/* Which model answered, and what it cost, beside the name
                      rather than trailing the reply. */}
                  {turn.role === "assistant" && !turn.pending && (
                    <TurnUsage
                      locale={locale}
                      model={turn.model}
                      usage={turn.usage}
                    />
                  )}
                </div>
                {/* Thinking and calls in the order they happened. A stored turn
                    from before rounds were kept has one block of reasoning. */}
                <TurnSteps
                  pending={turn.pending}
                  reasoningRounds={
                    turn.reasoningRounds ??
                    (turn.reasoning ? [turn.reasoning] : [])
                  }
                  toolRuns={turn.toolRuns ?? []}
                />
                {turn.role === "user" ? (
                  // What the user wrote is Nostr content, not markdown, and
                  // `RichText` is what renders that everywhere else: a mention
                  // becomes a name, an attached event becomes the embed a reply
                  // would get, hashtags and custom emoji included. The bech32
                  // the composer serialized never shows as bech32.
                  <RichText
                    className="max-w-full break-words text-sm"
                    content={turn.content}
                  />
                ) : (
                  <MessageResponse
                    // `text-sm`, like the question above it and like every event
                    // body in grimoire: markdown's base size made the reply the
                    // largest text on screen, which read as a different app.
                    className="max-w-full break-words text-sm"
                    components={markdownComponents}
                  >
                    {turn.content}
                  </MessageResponse>
                )}
              </div>
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* A preference is a preference: the chosen backend may be absent, and the
          window says which one answered instead rather than failing. */}
      {substitution && (
        <p className="mx-4 mb-2 text-xs text-muted-foreground">
          {substitution}
        </p>
      )}

      {/* A model download is minutes of nothing otherwise. */}
      {(awaitingModel || download !== undefined) && (
        <ModelDownload className="mx-4 mb-2" loaded={download} />
      )}

      {error && (
        <div className="mx-4 mb-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {!showIndex && composer}
    </div>
  );
}
