import { makeInferenceError } from "ipa-tools";

import { contentText } from "@/lib/message-content";

import type {
  BackendAvailability,
  Inference,
  InferenceBackend,
  InferenceChunk,
  InferenceRequest,
  Message,
} from "ipa-tools";
import type {
  PromptApi,
  PromptApiMessage,
  PromptApiSession,
} from "@/types/prompt-api";

/**
 * Chrome's built-in Prompt API as an `ipa-tools` fallback backend.
 *
 * Reached only when no injector is present: `createInference` tries IPA first,
 * every time. Nothing here is IPA — the page picked this model, not the user,
 * so it is labelled as on-device everywhere it surfaces.
 *
 * It cannot call tools, so a window on this backend keeps the fenced-command
 * path: Hex proposes, the user clicks.
 */
export const PROMPT_API_ID = "promptApi";

/** What `done.model` reports. Chrome does not name the model, so neither do we. */
export const PROMPT_API_MODEL = "chrome/on-device";

function promptApi(): PromptApi | undefined {
  return typeof globalThis.LanguageModel === "undefined"
    ? undefined
    : globalThis.LanguageModel;
}

/** True when the browser has the API at all, download state aside. */
export function isPromptApiPresent(): boolean {
  return promptApi() != null;
}

export async function promptApiAvailability(): Promise<BackendAvailability> {
  const api = promptApi();
  if (!api) return "unavailable";
  try {
    return await api.availability();
  } catch {
    return "unavailable";
  }
}

/**
 * The backend to hand `createInference({ fallbacks })`.
 *
 * `create()` is where a multi-hundred-megabyte model download starts, which is
 * why it needs a user gesture and why `onDownloadProgress` matters — see the
 * caller in `services/inference.ts`.
 */
export function createPromptApiBackend(): InferenceBackend {
  let session: PromptApiSession | undefined;

  return {
    id: PROMPT_API_ID,

    // No tool calling, and no `options` keys: this build exposes no
    // `LanguageModel.params()`, so temperature cannot be set safely.
    getFeatures: () => ({ toolCalling: false, options: {} }),

    probe: promptApiAvailability,

    async create({ onDownloadProgress, signal }) {
      const api = promptApi();
      if (!api) {
        throw makeInferenceError(
          "unavailable",
          "This browser has no built-in Prompt API.",
        );
      }

      // One session opens the model (and downloads it, once). Per-request
      // sessions are created from it so a system prompt is per-request and no
      // history leaks between turns.
      session ??= await createSession(api, undefined, {
        onDownloadProgress,
        signal,
      });

      return promptApiInference(api);
    },
  };
}

function promptApiInference(api: PromptApi): Inference {
  return {
    getFeatures: () => ({ toolCalling: false, options: {} }),
    request(request: InferenceRequest): AsyncIterable<InferenceChunk> {
      return {
        async *[Symbol.asyncIterator]() {
          if (request.tools?.length) {
            throw makeInferenceError(
              "invalid_request",
              "The on-device model cannot call tools.",
            );
          }
          throwIfAborted(request.signal);
          yield { type: "accepted" };

          const { system, prompts } = splitMessages(request.messages);
          if (prompts.length === 0) {
            throw makeInferenceError(
              "invalid_request",
              "A chat request needs at least one user message.",
            );
          }

          const turn = await createSession(api, system, {
            signal: request.signal,
          });
          try {
            let text = "";
            for await (const part of readStream(
              turn.promptStreaming(prompts, { signal: request.signal }),
              request.signal,
            )) {
              // Chrome has shipped both deltas and full-text-so-far chunks.
              // Telling them apart by prefix means either behaviour renders
              // once, instead of "The The quick The quick brown".
              const delta = part.startsWith(text)
                ? part.slice(text.length)
                : part;
              if (!delta) continue;
              text += delta;
              yield { type: "delta", content: delta };
            }

            yield {
              type: "done",
              model: PROMPT_API_MODEL,
              message: { role: "assistant", content: text },
            };
          } finally {
            turn.destroy();
          }
        },
      };
    },
  };
}

async function createSession(
  api: PromptApi,
  system: string | undefined,
  options: {
    onDownloadProgress?: (loaded: number) => void;
    signal?: AbortSignal;
  },
): Promise<PromptApiSession> {
  try {
    return await api.create({
      ...(system
        ? { initialPrompts: [{ role: "system", content: system }] }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onDownloadProgress
        ? {
            monitor: (monitor) =>
              monitor.addEventListener("downloadprogress", (event) =>
                options.onDownloadProgress?.(event.loaded),
              ),
          }
        : {}),
    });
  } catch (error) {
    throw translate(error);
  }
}

/**
 * IPA messages as Prompt API ones.
 *
 * The Prompt API knows three roles and throws on anything else, so a tool
 * result or a tool call becomes labelled user text — a conversation started
 * against a tool-calling provider still reads correctly after switching here.
 */
export function splitMessages(messages: Message[]): {
  system?: string;
  prompts: PromptApiMessage[];
} {
  const systems: string[] = [];
  const prompts: PromptApiMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        systems.push(message.content);
        break;
      case "user":
        prompts.push({ role: "user", content: contentText(message.content) });
        break;
      case "assistant": {
        const calls = message.toolCalls?.length
          ? message.toolCalls
              .map(
                (call) =>
                  `[called ${call.function.name}(${call.function.arguments})]`,
              )
              .join("\n")
          : "";
        const content = [contentText(message.content), calls]
          .filter(Boolean)
          .join("\n");
        if (content) prompts.push({ role: "assistant", content });
        break;
      }
      case "tool":
        prompts.push({
          role: "user",
          content: `[tool result] ${message.content}`,
        });
        break;
    }
  }

  return {
    ...(systems.length ? { system: systems.join("\n\n") } : {}),
    prompts,
  };
}

/** Read a stream with an explicit reader: async iteration is not in every build. */
async function* readStream(
  stream: ReadableStream<string>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  try {
    for (;;) {
      throwIfAborted(signal);
      const { done, value } = await reader.read().catch((error) => {
        throw translate(error);
      });
      if (done) return;
      if (typeof value === "string") yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw makeInferenceError("aborted", "Request cancelled.");
  }
}

/** Chrome's DOMExceptions as spec error codes. */
function translate(error: unknown): unknown {
  const name = (error as { name?: unknown })?.name;
  if (name === "AbortError") {
    return makeInferenceError("aborted", "Request cancelled.");
  }
  if (name === "NotSupportedError" || name === "NotReadableError") {
    return makeInferenceError(
      "unavailable",
      "The on-device model is not available.",
    );
  }
  if (name === "NotAllowedError") {
    return makeInferenceError(
      "permission_denied",
      "The browser refused to run the on-device model.",
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return makeInferenceError("provider_error", message);
}
