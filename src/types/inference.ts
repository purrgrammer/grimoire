/**
 * Inference Provider API (IPA) types, from `ipa-tools`.
 *
 * They were vendored while the package was 0.1; it now ships the same types plus
 * the fallback machinery grimoire uses, so this is a thin alias layer: the names
 * the app already uses (`InferenceMessage`, `InferenceTool`) mapped onto the
 * package's (`Message`, `Tool`), and `Inference` extended with the one thing
 * outside the spec.
 *
 * Note that `ipa-tools` augments `Window` with `inference?: Inference` — its
 * own, without the experimental namespace. Declaring it again here would
 * conflict, so `services/inference.ts` casts once at the lookup instead.
 *
 * https://github.com/SamSamskies/inference-provider-api/blob/main/SPEC.md
 */

import type {
  ChatChunk,
  ChatRequest,
  Inference as IpaInference,
  Tool as IpaTool,
} from "ipa-tools";

export type {
  ChatChunk,
  ChatRequest,
  DoneChunk,
  InferenceChunk,
  InferenceChunkFor,
  InferenceError,
  InferenceErrorCode,
  InferenceFeatures,
  InferenceOptions,
  InferenceRequest,
  Message as InferenceMessage,
  ReasoningEffort,
  Tool as InferenceTool,
  ToolCall,
  ToolChoice,
  Usage,
} from "ipa-tools";

/**
 * A function tool: the only kind of `Tool` carrying a name, description and
 * schema. Since ipa-tools 0.4 `Tool` also admits `{ type: "web_search" }`, which
 * has no `function`, so anything that reads those fields takes this instead.
 */
export type InferenceFunctionTool = Extract<IpaTool, { type: "function" }>;

export type Inference = IpaInference & {
  /**
   * Injector-specific surface, outside the spec. Inference Bridge exposes tool
   * calling here while `getFeatures().toolCalling` is still false, so this is
   * the only way to use tools today. The spec tells applications to target
   * `request`/`getFeatures` and not extension namespaces — so everything that
   * touches this is labelled experimental in the UI, and the standard path is
   * preferred whenever it advertises support.
   */
  experimental?: {
    /**
     * Chat-only, like everything grimoire asks of a provider. Since ipa-tools
     * 1.0 `InferenceRequest` is a union (chat | decide | transcribe |
     * synthesize) and the spec's `request` is generic over it; this namespace
     * predates that split and only ever carried chat, so it stays concrete
     * rather than claiming methods no injector implements here.
     */
    request?(request: ChatRequest): AsyncIterable<ChatChunk>;
    runTools?(options: unknown): Promise<unknown>;
  };
};
