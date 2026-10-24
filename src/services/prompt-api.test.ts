import { afterEach, describe, expect, it } from "vitest";

import {
  createPromptApiBackend,
  isPromptApiPresent,
  promptApiAvailability,
  PROMPT_API_MODEL,
  splitMessages,
} from "./prompt-api";

import {
  createMockPromptApi,
  installMockPromptApi,
  type MockPromptApi,
} from "@/test/mock-prompt-api";

import type { InferenceChunk, InferenceMessage } from "@/types/inference";

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

const ask: InferenceMessage[] = [{ role: "user", content: "hi" }];

async function drain(
  stream: AsyncIterable<InferenceChunk>,
): Promise<InferenceChunk[]> {
  const chunks: InferenceChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function inferenceOf(mock: MockPromptApi) {
  restore = installMockPromptApi(mock);
  return createPromptApiBackend().create({});
}

describe("availability", () => {
  it("is unavailable when the browser has no Prompt API", async () => {
    restore = installMockPromptApi(undefined);
    expect(isPromptApiPresent()).toBe(false);
    expect(await promptApiAvailability()).toBe("unavailable");
  });

  it("reports each of Chrome's states as the backend's", async () => {
    for (const state of [
      "unavailable",
      "downloadable",
      "downloading",
      "available",
    ] as const) {
      restore?.();
      restore = installMockPromptApi(
        createMockPromptApi({ availability: state }),
      );
      expect(await createPromptApiBackend().probe()).toBe(state);
    }
  });

  it("treats a throwing availability check as unavailable, not a crash", async () => {
    restore = installMockPromptApi({
      availability: () => Promise.reject(new Error("nope")),
      create: () => Promise.reject(new Error("nope")),
    });
    expect(await promptApiAvailability()).toBe("unavailable");
  });
});

describe("streaming", () => {
  it("yields accepted, deltas, then one done", async () => {
    const mock = createMockPromptApi({ chunks: ["hel", "lo"] });
    const inference = await inferenceOf(mock);
    const chunks = await drain(
      inference.request({ method: "chat", messages: ask }),
    );

    expect(chunks).toEqual([
      { type: "accepted" },
      { type: "delta", content: "hel" },
      { type: "delta", content: "lo" },
      {
        type: "done",
        model: PROMPT_API_MODEL,
        message: { role: "assistant", content: "hello" },
      },
    ]);
  });

  it("does not repeat text when Chrome sends the whole answer each chunk", async () => {
    // Chrome has shipped both; a cumulative stream taken as deltas renders
    // "hel hello".
    const mock = createMockPromptApi({
      chunks: ["hel", "lo"],
      chunkStyle: "cumulative",
    });
    const inference = await inferenceOf(mock);
    const chunks = await drain(
      inference.request({ method: "chat", messages: ask }),
    );

    expect(chunks.filter((chunk) => chunk.type === "delta")).toEqual([
      { type: "delta", content: "hel" },
      { type: "delta", content: "lo" },
    ]);
    expect(chunks[chunks.length - 1]).toMatchObject({
      message: { content: "hello" },
    });
  });

  it("destroys the session even when the stream fails", async () => {
    const mock = createMockPromptApi({
      chunks: ["half"],
      streamError: new Error("model died"),
    });
    const inference = await inferenceOf(mock);
    await expect(
      drain(inference.request({ method: "chat", messages: ask })),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(mock.destroyed).toBe(1);
  });

  it("reports an abort as `aborted`", async () => {
    const mock = createMockPromptApi({ chunks: ["a", "b", "c"] });
    const inference = await inferenceOf(mock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      drain(
        inference.request({
          method: "chat",
          messages: ask,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("refuses tools rather than dropping them silently", async () => {
    const mock = createMockPromptApi();
    const inference = await inferenceOf(mock);

    await expect(
      drain(
        inference.request({
          method: "chat",
          messages: ask,
          tools: [{ type: "function", function: { name: "query_nostr" } }],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(inference.getFeatures?.().toolCalling).toBe(false);
  });

  it("refuses an unadvertised method before the stream is pulled", async () => {
    // ipa-tools 1.0 widened `InferenceRequest` to chat | decide | transcribe |
    // synthesize and requires an implementation to reject a method it does not
    // advertise *before* yielding. Throwing from inside the generator body
    // would defer it to the first pull, so a caller that only checks whether a
    // stream was returned would think the request had been accepted.
    const mock = createMockPromptApi();
    const inference = await inferenceOf(mock);
    const decide = {
      method: "decide",
      state: "{}",
      questions: [{ id: "q", prompt: "pick", type: "boolean" }],
    } as unknown as Parameters<typeof inference.request>[0];

    expect(() => inference.request(decide)).toThrowError(
      expect.objectContaining({ code: "invalid_request" }),
    );
  });

  it("ignores option keys it does not advertise", async () => {
    // `runToolLoop` sends `reasoningEffort` unconditionally, which the spec says
    // an implementation must ignore rather than reject.
    const mock = createMockPromptApi({ chunks: ["ok"] });
    const inference = await inferenceOf(mock);
    const chunks = await drain(
      inference.request({
        method: "chat",
        messages: ask,
        options: { reasoningEffort: "high", temperature: 1.5 },
      }),
    );
    expect(chunks[chunks.length - 1]).toMatchObject({ type: "done" });
  });

  it("reports download progress while opening the model", async () => {
    const mock = createMockPromptApi();
    mock.downloadProgress = [0.25, 1];
    restore = installMockPromptApi(mock);
    const seen: number[] = [];
    await createPromptApiBackend().create({
      onDownloadProgress: (loaded) => seen.push(loaded),
    });
    expect(seen).toEqual([0.25, 1]);
  });
});

describe("message mapping", () => {
  it("joins system messages and keeps them out of the prompt", () => {
    const { system, prompts } = splitMessages([
      { role: "system", content: "you are Hex" },
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(system).toBe("you are Hex\n\nbe brief");
    expect(prompts).toEqual([{ role: "user", content: "hi" }]);
  });

  it("sends the system prompt at create time, where the API takes it", async () => {
    const mock = createMockPromptApi({ chunks: ["ok"] });
    const inference = await inferenceOf(mock);
    await drain(
      inference.request({
        method: "chat",
        messages: [
          { role: "system", content: "you are Hex" },
          { role: "user", content: "hi" },
        ],
      }),
    );
    // First create opens the model, second is the turn.
    expect(mock.creates[mock.creates.length - 1]?.initialPrompts).toEqual([
      { role: "system", content: "you are Hex" },
    ]);
    expect(mock.prompts[mock.prompts.length - 1]).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("labels tool traffic as text, because the API knows three roles", () => {
    const { prompts } = splitMessages([
      { role: "user", content: "who posted?" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "1",
            type: "function",
            function: { name: "query_nostr", arguments: '{"kinds":[1]}' },
          },
        ],
      },
      { role: "tool", toolCallId: "1", content: '{"count":2}' },
    ]);

    expect(prompts).toEqual([
      { role: "user", content: "who posted?" },
      { role: "assistant", content: '[called query_nostr({"kinds":[1]})]' },
      { role: "user", content: '[tool result] {"count":2}' },
    ]);
  });

  it("refuses a request with nothing to answer", async () => {
    const mock = createMockPromptApi();
    const inference = await inferenceOf(mock);
    await expect(
      drain(
        inference.request({
          method: "chat",
          messages: [{ role: "system", content: "only a system prompt" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
