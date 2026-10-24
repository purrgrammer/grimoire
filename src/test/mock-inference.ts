import type {
  ChatChunk,
  ChatRequest,
  Inference,
  InferenceChunkFor,
  InferenceErrorCode,
  InferenceFeatures,
  InferenceRequest,
} from "@/types/inference";

/**
 * Minimal `window.inference` injector for tests.
 *
 * Exists for the same reason as mock-relay: the behaviours that break a client
 * are the awkward ones. An IPA implementation is a browser extension, so CI has
 * none — and the failure modes that matter (a stream that ends without `done`,
 * an error reconstructed across an isolated world so `instanceof` fails, an
 * abort mid-stream) cannot be produced by a well-behaved provider.
 */
export type MockInferenceBehaviour =
  /** Stream `deltas`, then a `done` whose content is their concatenation. */
  | { kind: "normal"; deltas?: string[]; reasoning?: string[]; model?: string }
  /** Deltas, then the stream just ends. No `done` — a spec violation. */
  | { kind: "no-done"; deltas?: string[] }
  /**
   * Throw after `accepted`. The error is a plain object with a `code`, exactly
   * as an extension reconstructs it — `instanceof Error` is false.
   */
  | { kind: "error"; code: InferenceErrorCode; message?: string }
  /** Never yields anything after `accepted`; only an abort ends it. */
  | { kind: "hang" }
  /**
   * Answer with tool calls on each listed round, then with text. Lets the
   * page-side tool loop be exercised without an injector that advertises
   * toolCalling — no shipped one does yet.
   */
  | {
      kind: "tool-calls";
      /** One entry per round; an empty array ends the loop with `text`. */
      rounds: Array<Array<{ name: string; arguments?: string }>>;
      text?: string;
      /**
       * Reasoning per round, streamed and then repeated in that round's `done`
       * message — which is what real providers do, and what makes a caller that
       * assigns rather than accumulates lose the earlier rounds.
       */
      reasoning?: string[];
    };

export interface MockInference extends Inference {
  /**
   * Requests received, for asserting the caller isn't re-requesting. Chat-only:
   * grimoire sends nothing else, and the union ipa-tools 1.0 introduced would
   * hide `messages` from every assertion for no gain.
   */
  requests: ChatRequest[];
}

/**
 * Build a mock `Inference`. Install with `installMockInference` or pass its
 * `request` directly.
 */
export function createMockInference(
  behaviour: MockInferenceBehaviour,
  features: InferenceFeatures = {},
): MockInference {
  const requests: ChatRequest[] = [];
  let round = 0;

  return {
    requests,
    getFeatures: () => features,
    request<R extends InferenceRequest>(
      request: R,
    ): AsyncIterable<InferenceChunkFor<R>> {
      // Chat only, like the real injectors grimoire talks to. Rejecting before
      // the generator body matches what ipa-tools 1.0 asks of implementations.
      if (!("messages" in request)) {
        throw reconstructedError(
          "invalid_request",
          "The mock only answers chat requests.",
        );
      }
      const chat = request as unknown as ChatRequest;
      requests.push(chat);
      const stream: AsyncIterable<ChatChunk> = {
        async *[Symbol.asyncIterator]() {
          throwIfAborted(chat);
          yield { type: "accepted" };

          if (behaviour.kind === "tool-calls") {
            const calls = behaviour.rounds[round] ?? [];
            const thought = behaviour.reasoning?.[round];
            round++;
            if (thought) {
              yield { type: "reasoning_delta", content: thought };
            }
            if (calls.length > 0) {
              yield {
                type: "done",
                model: "mock-model",
                message: {
                  role: "assistant",
                  content: null,
                  ...(thought ? { reasoning: thought } : {}),
                  toolCalls: calls.map((call, index) => ({
                    id: `call-${round}-${index}`,
                    type: "function",
                    function: {
                      name: call.name,
                      arguments: call.arguments ?? "{}",
                    },
                  })),
                },
              };
              return;
            }
            const text = behaviour.text ?? "done";
            yield { type: "delta", content: text };
            yield {
              type: "done",
              model: "mock-model",
              message: {
                role: "assistant",
                content: text,
                ...(thought ? { reasoning: thought } : {}),
              },
              usage: { inputTokens: 1, outputTokens: 1 },
            };
            return;
          }

          if (behaviour.kind === "hang") {
            await new Promise<void>((_resolve, reject) => {
              // Re-check inside the promise: abort can land between the
              // generator starting and this listener being attached.
              throwIfAborted(chat);
              chat.signal?.addEventListener(
                "abort",
                () => reject(reconstructedError("aborted", "Request aborted")),
                { once: true },
              );
            });
            return;
          }

          if (behaviour.kind === "error") {
            throw reconstructedError(behaviour.code, behaviour.message);
          }

          const reasoning =
            behaviour.kind === "normal" ? (behaviour.reasoning ?? []) : [];
          for (const content of reasoning) {
            throwIfAborted(chat);
            yield { type: "reasoning_delta", content };
          }

          const deltas = behaviour.deltas ?? [];
          for (const content of deltas) {
            throwIfAborted(chat);
            yield { type: "delta", content };
          }

          if (behaviour.kind === "no-done") return;

          throwIfAborted(chat);
          yield {
            type: "done",
            model: behaviour.model ?? "mock-model",
            message: {
              role: "assistant",
              content: deltas.join("") || null,
              ...(reasoning.length ? { reasoning: reasoning.join("") } : {}),
            },
            usage: { inputTokens: 1, outputTokens: deltas.length },
          };
        },
      };
      // Narrowed above: `R` is a chat request, so its chunk type is ChatChunk.
      return stream as AsyncIterable<InferenceChunkFor<R>>;
    },
  };
}

/**
 * Install onto `window.inference`. Returns a restore function.
 * Vitest runs in the node environment, so `window` is stubbed when absent.
 */
export function installMockInference(mock: Inference | undefined): () => void {
  const scope = globalThis as { window?: { inference?: Inference } };
  const hadWindow = scope.window !== undefined;
  if (!hadWindow) scope.window = {};
  const target = scope.window!;
  const previous = target.inference;
  target.inference = mock;
  return () => {
    if (!hadWindow) {
      scope.window = undefined;
      return;
    }
    target.inference = previous;
  };
}

function throwIfAborted(request: ChatRequest): void {
  if (request.signal?.aborted) {
    throw reconstructedError("aborted", "Request aborted");
  }
}

/**
 * An error as an extension delivers it: a structured-clone-safe object with a
 * `code`, not an `Error` subclass. Anything matching on `instanceof` fails here.
 */
function reconstructedError(code: InferenceErrorCode, message?: string) {
  return { name: "InferenceError", message: message ?? code, code };
}
