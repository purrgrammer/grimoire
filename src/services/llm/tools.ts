/**
 * Tool System for AI Chat
 *
 * Defines the interface for tools that can be called by AI models.
 * Tools are registered with the ToolRegistry and executed during the agentic loop.
 */

import type { ToolDefinition, ToolCall, ToolMessage } from "@/types/llm";

// ─────────────────────────────────────────────────────────────
// Tool Interface
// ─────────────────────────────────────────────────────────────

/**
 * Context provided to tool execution.
 */
export interface ToolContext {
  /** The conversation ID this tool is being executed for */
  conversationId: string;
  /** The provider instance ID */
  providerInstanceId: string;
  /** The model ID */
  modelId: string;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result from tool execution.
 */
export interface ToolResult {
  /** Whether the execution was successful */
  success: boolean;
  /** The result content (will be sent back to the model) */
  content: string;
  /** Optional error message */
  error?: string;
}

/**
 * A tool that can be called by the AI model.
 */
export interface Tool {
  /** Unique tool name (must match what's sent to the model) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for the parameters */
  parameters: Record<string, unknown>;

  /**
   * Execute the tool with the given arguments.
   * @param args Parsed arguments from the model
   * @param context Execution context
   * @returns Tool result
   */
  execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────
// Tool Registry
// ─────────────────────────────────────────────────────────────

class ToolRegistryImpl {
  private tools = new Map<string, Tool>();

  /**
   * Register a tool.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is already registered, overwriting.`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool definitions for the API.
   */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistryImpl();

// ─────────────────────────────────────────────────────────────
// Tool Executor
// ─────────────────────────────────────────────────────────────

/**
 * Execute a tool call and return a ToolMessage.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  context: ToolContext,
): Promise<ToolMessage> {
  const tool = toolRegistry.get(toolCall.function.name);

  if (!tool) {
    return {
      id: crypto.randomUUID(),
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: `Unknown tool: ${toolCall.function.name}`,
      }),
      timestamp: Date.now(),
    };
  }

  try {
    // Parse arguments
    let args: Record<string, unknown> = {};
    if (toolCall.function.arguments) {
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        return {
          id: crypto.randomUUID(),
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: "Failed to parse tool arguments as JSON",
          }),
          timestamp: Date.now(),
        };
      }
    }

    // Execute the tool
    const result = await tool.execute(args, context);

    return {
      id: crypto.randomUUID(),
      role: "tool",
      tool_call_id: toolCall.id,
      content: result.success
        ? result.content
        : JSON.stringify({ error: result.error || "Tool execution failed" }),
      timestamp: Date.now(),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return {
      id: crypto.randomUUID(),
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: errorMessage }),
      timestamp: Date.now(),
    };
  }
}

/**
 * Execute multiple tool calls in parallel.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  context: ToolContext,
): Promise<ToolMessage[]> {
  return Promise.all(toolCalls.map((tc) => executeToolCall(tc, context)));
}
