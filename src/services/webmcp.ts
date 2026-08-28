import { toolsForSurface, type ToolExecutor } from "@/lib/ai-registry";

/**
 * WebMCP: grimoire's tools, registered with the browser's own agent.
 *
 * The page declares what it can do — `document.modelContext.registerTool()` —
 * and whatever agent the browser carries (Chrome/Edge origin trials, Brave's
 * Leo, ChatGPT Desktop) calls those tools instead of driving the UI by pixels.
 * Same registry Hex reads, so a tool is defined once and reached two ways:
 * Hex's own loop (`services/tool-loop.ts`) relays calls to an inference
 * provider, while here the loop belongs to the browser and grimoire only
 * answers.
 *
 * https://webmachinelearning.github.io/webmcp/
 *
 * Three things the spec requires that a page cannot detect its way around:
 *
 * - **A secure context** and an **origin-keyed agent cluster**. Without
 *   `Origin-Agent-Cluster: ?1` on the document's response, `registerTool()`
 *   rejects with `SecurityError` — the header is set for the dev server in
 *   `vite.config.ts` and for the deployed origin in `vercel.json`.
 * - **A unique name per tool.** Registering a name twice rejects with
 *   `InvalidStateError`, so registration is serialized and a duplicate is
 *   treated as already-registered rather than as a failure.
 * - **A JSON-serializable return.** The user agent serializes whatever the
 *   executor resolves with; a value `JSON.stringify` refuses fails the call
 *   with no message at all, which is why every result is checked here first.
 *
 * A rejected executor tells the agent nothing but "it failed", so nothing in
 * here throws: a failure comes back as `{ error }`, the same shape the tools
 * already use for a refusal.
 */

/** The subset of the WebMCP IDL grimoire uses. Not in TypeScript's lib yet. */
interface ModelContextToolInit {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (
    input: object,
    options: { signal: AbortSignal },
  ) => Promise<unknown>;
}

interface ModelContext {
  registerTool(
    tool: ModelContextToolInit,
    options?: { exposedTo?: string[]; signal?: AbortSignal },
  ): Promise<void>;
}

export interface ModelContextRegistration {
  /** False when the browser has no `document.modelContext` at all. */
  supported: boolean;
  /** Canonical ids now reachable by the browser's agent. */
  registered: string[];
  /** Ids the user agent refused, with why — a dead tool, not a dead page. */
  failed: { id: string; error: string }[];
}

function modelContext(): ModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  // A feature-detect, not a type guard: an origin trial that expired mid-session
  // leaves the property in place, and its methods still reject on their own.
  return context && typeof context.registerTool === "function"
    ? context
    : undefined;
}

/** Whether this browser exposes WebMCP to the page at all. */
export function modelContextAvailable(): boolean {
  return modelContext() !== undefined;
}

/**
 * Serialized so a re-registration cannot overlap a teardown.
 *
 * Registration is async and unregistration is an `AbortSignal` — a remount
 * that started registering before the previous signal was processed would hit
 * the duplicate-name rejection and drop the tool for the whole session.
 */
let pending: Promise<unknown> = Promise.resolve();

/** Whatever a tool returns, as something the user agent can serialize. */
function serializable(value: unknown): unknown {
  try {
    // Round-tripped rather than only stringified: the value is handed back, and
    // this is what the user agent will make of it.
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return {
      error: "This tool produced a result that could not be serialized.",
    };
  }
}

function wrap(id: string, executor: ToolExecutor) {
  return async (input: object): Promise<unknown> => {
    try {
      return serializable(await executor(input));
    } catch (error) {
      // Reported as data. A rejected promise reaches the agent as a bare
      // failure with no reason, and the reason is usually the whole answer.
      return {
        error: `${id} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/**
 * Register every `webmcp` tool in the registry, for as long as `signal` lives.
 *
 * `hosts` supplies the executors that need application state — the same
 * injection the IPA loop uses, keyed by canonical id. A `host` tool with
 * nothing supplied is skipped rather than registered as a stub.
 */
export async function registerModelContextTools(
  hosts: Record<string, ToolExecutor> = {},
  signal?: AbortSignal,
): Promise<ModelContextRegistration> {
  const context = modelContext();
  if (!context) return { supported: false, registered: [], failed: [] };

  const run = pending.then(async () => {
    const registered: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const tool of toolsForSurface("webmcp")) {
      if (signal?.aborted) break;
      const executor = tool.host ? hosts[tool.id] : tool.execute;
      if (!executor) continue;

      try {
        await context.registerTool(
          {
            // The canonical id, dots and all: WebMCP names allow
            // `[A-Za-z0-9_.-]`, so unlike IPA this surface needs no mangling
            // and a stored transcript names the same tool either way.
            name: tool.id,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.parameters,
            annotations: tool.annotations,
            execute: wrap(tool.id, executor),
          },
          signal ? { signal } : {},
        );
        registered.push(tool.id);
      } catch (error) {
        // A name already registered is this page's own tool, from a remount
        // whose teardown has not been processed. Nothing is wrong with it.
        if (
          error instanceof DOMException &&
          error.name === "InvalidStateError"
        ) {
          registered.push(tool.id);
          continue;
        }
        failed.push({
          id: tool.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      supported: true,
      registered,
      failed,
    } satisfies ModelContextRegistration;
  });

  pending = run.catch(() => undefined);
  return run;
}
