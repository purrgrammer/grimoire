/**
 * Inference Provider API access, plus the one fallback grimoire ships.
 *
 * Not a singleton — `window.inference` is injected by an extension, so IPA is a
 * lookup, not state we own. The fallback client is a singleton, because it holds
 * one on-device model session.
 *
 * Errors carry a `code`; match on that, never `instanceof`. Injectors
 * reconstruct the error across isolated worlds, so the prototype is lost.
 */

import {
  getInference as getIpaInference,
  isInferenceAvailable as isIpaAvailable,
  isInferenceError,
  makeInferenceError,
} from "ipa-tools";

import {
  describeBackends,
  fallbackClient,
  ipaToolSupport,
  IPA_ID,
  isPromptApiPresent,
  onDeviceInference,
  promptApiAvailability,
  PROMPT_API_ID,
  type BackendPreference,
  type ToolSupport,
} from "./inference-backends";

import type { BackendAvailability } from "ipa-tools";
import type {
  ChatChunk,
  ChatRequest,
  DoneChunk,
  Inference,
  InferenceFeatures,
} from "@/types/inference";

// Re-exported so callers keep one import site for the whole surface.
export {
  isInferenceError,
  makeInferenceError,
  serializeToolResult,
} from "ipa-tools";

/**
 * Parse a tool call's arguments. Empty means no arguments, not an error —
 * providers send `""` for a zero-argument call.
 *
 * Not `ipa-tools`' version, which throws `invalid_request` on malformed JSON:
 * that ends the turn, where the loop here hands the model an error result it
 * can correct from. A model that mangles its own arguments should get a chance
 * to notice.
 */
export function parseToolArguments(json: string | undefined): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Human-readable reason for a failed request, for surfacing in a window. */
export function describeInferenceError(error: unknown): string {
  if (!isInferenceError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.code) {
    case "unavailable":
      return "No inference provider is available. Install an extension that injects window.inference.";
    case "permission_denied":
      return "This origin was denied access to inference.";
    case "invalid_request":
      return `The provider rejected the request: ${error.message}`;
    case "aborted":
      return "Request cancelled.";
    default:
      return error.message || "The provider failed.";
  }
}

/**
 * True when an injector is present. Synchronous, so it can gate a menu item —
 * the fallback's availability is asynchronous, see {@link probeInference}.
 */
export function isInferenceAvailable(): boolean {
  return isIpaAvailable();
}

/** True when anything can answer, injector or on-device model. */
export function isAnyInferenceReachable(): boolean {
  return isIpaAvailable() || isPromptApiPresent();
}

export function getInference(): Inference {
  // `ipa-tools` types `window.inference` without the experimental namespace,
  // which is real and the only way to send tools today.
  return getIpaInference() as Inference;
}

/**
 * Capability snapshot. Absent `getFeatures` advertises nothing, and the result
 * never names a provider or model — the extension owns that choice.
 */
export function getInferenceFeatures(): InferenceFeatures {
  if (!isIpaAvailable()) return {};
  return getInference().getFeatures?.() ?? {};
}

export interface InferenceReach {
  /** An injector is present. */
  ipa: boolean;
  /** State of the on-device fallback. */
  fallback: BackendAvailability;
}

/**
 * What can answer right now. Asynchronous because the on-device model reports
 * four states, one of which is a download that has not happened yet.
 */
export async function probeInference(): Promise<InferenceReach> {
  const status = await fallbackClient().probe();
  return {
    ipa: status.ipa === "available",
    fallback: (status[PROMPT_API_ID] as BackendAvailability) ?? "unavailable",
  };
}

/** Availability of the on-device model alone, without probing the injector. */
export { promptApiAvailability };

// One import site for the whole surface, as before the backends moved out.
export {
  describeBackends,
  IPA_ID,
  onModelDownloadProgress,
  PROMPT_API_ID,
  type BackendPreference,
  type ToolSupport,
} from "./inference-backends";

/** Both backends and their state, for a selector. */
export function listBackends() {
  return describeBackends(isIpaAvailable() ? getInference() : undefined);
}

export interface ResolvedRequest {
  /**
   * Chat-only. ipa-tools 1.0 made `Inference["request"]` generic over a
   * request union (chat | decide | transcribe | synthesize); grimoire only
   * ever sends chat, and a generic signature here would force every caller to
   * prove which method it meant for no gain.
   */
  request: (request: ChatRequest) => AsyncIterable<ChatChunk>;
  tools: ToolSupport;
  /** True when the answer will come from the page's own model, not an injector. */
  onDevice?: boolean;
  /**
   * Set when the chosen backend could not answer and another one did. A
   * preference is a preference: a missing extension must not turn into an error
   * the user has to decode, but the window has to say what happened.
   */
  substituted?: typeof IPA_ID | typeof PROMPT_API_ID;
}

/**
 * Pick the request function to use, honouring a backend preference.
 *
 * IPA is decided here rather than inside the client because the experimental
 * namespace is injector-specific: the client only knows `request`, so routing
 * an injected provider through it would silently drop tool calling.
 *
 * Forcing on-device also has to happen here: `ipa-tools`' resolver is IPA-first
 * and rejects `"ipa"` as a fallback entry, so with an extension installed the
 * client would answer through it every time and the preference would do nothing.
 */
export function resolveRequest(
  preference: BackendPreference = "auto",
): ResolvedRequest {
  // Asked for on-device, and the browser has one: drive the backend directly.
  // `create()` — and so the download — happens inside the request, on the send
  // the user made.
  if (preference === PROMPT_API_ID && isPromptApiPresent()) {
    return {
      request: (request) => ({
        async *[Symbol.asyncIterator]() {
          const inference = await onDeviceInference(request.signal);
          yield* inference.request(request);
        },
      }),
      tools: "none",
      onDevice: true,
    };
  }

  const wanted = preference === "auto" ? undefined : preference;

  if (!isIpaAvailable()) {
    // No injector. The client resolves the fallback lazily, inside the request,
    // and re-checks IPA on the way — so a late injection still wins.
    const fallback = fallbackClient();
    return {
      request: (request) => fallback.request(request),
      tools: "none",
      onDevice: true,
      // Only a substitution if something else was asked for; with no preference
      // this is simply what is available.
      ...(wanted === IPA_ID ? { substituted: PROMPT_API_ID } : {}),
    };
  }

  const inference = getInference();
  const tools = ipaToolSupport(inference);
  const request =
    tools === "experimental" && inference.experimental?.request
      ? inference.experimental.request.bind(inference.experimental)
      : inference.request.bind(inference);

  return {
    request,
    tools,
    // Wanted the on-device model, which this browser does not have.
    ...(wanted === PROMPT_API_ID ? { substituted: IPA_ID } : {}),
  };
}

/** Drain a stream to its single `done` chunk, ignoring deltas. */
export async function complete(request: ChatRequest): Promise<DoneChunk> {
  let done: DoneChunk | undefined;
  for await (const chunk of resolveRequest().request(request)) {
    if (chunk.type === "done") done = chunk;
  }
  if (!done) {
    if (request.signal?.aborted) {
      throw makeInferenceError("aborted", "Request cancelled.");
    }
    throw makeInferenceError(
      "provider_error",
      "Stream ended without a done chunk.",
    );
  }
  return done;
}
