import { contentText } from "@/lib/message-content";
import {
  makeInferenceError,
  parseToolArguments,
  serializeToolResult,
} from "./inference";

import type {
  DoneChunk,
  Inference,
  InferenceMessage,
  InferenceTool,
  ToolCall,
  Usage,
} from "@/types/inference";
import type { ToolRun } from "@/types/tool-part";

/**
 * The page-side function-tool loop.
 *
 * IPA relays tool calls; it is explicitly not an agent runtime, so the loop
 * belongs here. Lives in a service rather than the viewer because this is the
 * part with rounds, aborts and failure modes worth testing — the viewer only
 * renders what it reports.
 */

export type ToolExecutors = Record<string, (args: unknown) => Promise<unknown>>;

export interface ToolLoopOptions {
  request: Inference["request"];
  messages: InferenceMessage[];
  /** Omit when the injector does not advertise toolCalling. */
  tools?: InferenceTool[];
  executors?: ToolExecutors;
  /** Rounds before giving up on a model that will not stop calling. */
  maxRounds?: number;
  signal?: AbortSignal;
  /**
   * The reply so far, not the delta. A snapshot because the loop drops the
   * preamble a tool-calling round emits, so a caller appending deltas itself
   * would end up with text the finished turn does not contain.
   */
  onDelta?: (content: string) => void;
  /**
   * Reasoning per round, in order. An array rather than one string so the UI
   * can interleave it with the calls each round made.
   */
  onReasoningDelta?: (rounds: string[]) => void;
  /** Called whenever a run starts or finishes, with a snapshot. */
  onToolRuns?: (runs: ToolRun[]) => void;
}

export interface ToolLoopResult {
  content: string;
  /** Every round's reasoning, joined. */
  reasoning?: string;
  /** Every round's reasoning, kept apart so it can be shown in order. */
  reasoningRounds: string[];
  model?: string;
  usage?: Usage;
  toolRuns: ToolRun[];
}

const DEFAULT_MAX_ROUNDS = 4;

export async function runToolLoop(
  options: ToolLoopOptions,
): Promise<ToolLoopResult> {
  const {
    request,
    tools,
    executors = {},
    maxRounds = DEFAULT_MAX_ROUNDS,
    signal,
    onDelta,
    onReasoningDelta,
    onToolRuns,
  } = options;

  let messages = options.messages;
  const toolRuns: ToolRun[] = [];
  let content = "";
  let model: string | undefined;
  let usage: Usage | undefined;
  // Reasoning is kept per round and joined, because a `done` chunk carries the
  // whole round's reasoning: assigning it would erase what earlier rounds
  // thought, which is exactly the part that explains a tool call.
  const priorReasoning: string[] = [];
  let roundReasoning = "";
  // Positional: a round that thought nothing keeps its empty slot, so a run's
  // `round` still indexes the reasoning that preceded it.
  const reasoningRounds = () => [...priorReasoning, roundReasoning];
  const reasoningSoFar = () => reasoningRounds().filter(Boolean).join("\n\n");

  const report = () => onToolRuns?.(toolRuns.map((run) => ({ ...run })));

  for (let round = 0; round < maxRounds; round++) {
    if (signal?.aborted)
      throw makeInferenceError("aborted", "Request cancelled.");

    let done: DoneChunk | undefined;
    for await (const chunk of request({
      method: "chat",
      messages,
      ...(tools?.length ? { tools } : {}),
      // Unadvertised option keys must be ignored, not rejected, so this is safe
      // to send unconditionally.
      options: { reasoningEffort: "auto" },
      ...(signal ? { signal } : {}),
    })) {
      switch (chunk.type) {
        case "delta":
          content += chunk.content;
          onDelta?.(content);
          break;
        case "reasoning_delta":
          roundReasoning += chunk.content;
          onReasoningDelta?.(reasoningRounds());
          break;
        case "done":
          done = chunk;
          model = chunk.model;
          usage = chunk.usage;
          if (chunk.message.role === "assistant") {
            if (chunk.message.content != null)
              content = contentText(chunk.message.content);
            if (chunk.message.reasoning) {
              roundReasoning = chunk.message.reasoning;
              onReasoningDelta?.(reasoningRounds());
            }
          }
          break;
        default:
          break;
      }
    }

    if (!done) {
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request cancelled.");
      }
      throw makeInferenceError(
        "provider_error",
        "Stream ended without a done chunk.",
      );
    }

    const assistant =
      done.message.role === "assistant" ? done.message : undefined;
    const calls: ToolCall[] = assistant?.toolCalls ?? [];
    if (calls.length === 0) {
      const reasoning = reasoningSoFar();
      return {
        content,
        ...(reasoning ? { reasoning } : {}),
        reasoningRounds: reasoningRounds(),
        ...(model ? { model } : {}),
        ...(usage ? { usage } : {}),
        toolRuns,
      };
    }

    // Show the calls before running them, so a slow relay query reads as work
    // in progress rather than a stall.
    const started: ToolRun[] = calls.map((call) => ({
      name: call.function.name,
      input: parseToolArguments(call.function.arguments),
      state: "input-available",
      round,
    }));
    toolRuns.push(...started);
    report();

    const results: InferenceMessage[] = [];
    for (const [index, call] of calls.entries()) {
      if (signal?.aborted) {
        throw makeInferenceError("aborted", "Request cancelled.");
      }

      const run = started[index];
      const executor = executors[run.name];
      let output: unknown;

      if (!executor) {
        run.state = "output-error";
        run.errorText = `No such tool: ${run.name}`;
        output = { error: run.errorText };
      } else {
        try {
          output = await executor(run.input);
          run.state = "output-available";
          run.output = output;
        } catch (caught) {
          run.state = "output-error";
          run.errorText =
            caught instanceof Error ? caught.message : String(caught);
          output = { error: run.errorText };
        }
      }

      report();
      results.push({
        role: "tool",
        toolCallId: call.id,
        content: serializeToolResult(output),
      });
    }

    messages = [
      ...messages,
      {
        role: "assistant",
        content: assistant?.content ?? null,
        toolCalls: calls,
        ...(assistant?.reasoning ? { reasoning: assistant.reasoning } : {}),
      },
      ...results,
    ];
    // Text emitted alongside a tool call is preamble; the answer comes after.
    content = "";
    onDelta?.(content);
    // Close this round's reasoning so the next one appends rather than replaces.
    priorReasoning.push(roundReasoning);
    roundReasoning = "";
  }

  throw makeInferenceError(
    "provider_error",
    `The model kept calling tools past ${maxRounds} rounds.`,
  );
}
