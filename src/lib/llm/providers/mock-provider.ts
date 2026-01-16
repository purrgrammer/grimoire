/**
 * Mock LLM provider for testing/demonstration
 * Simulates streaming responses without actual API calls
 */

import type {
  LLMProvider,
  LLMProviderAdapter,
  LLMMessage,
  LLMConversationSettings,
  LLMStreamChunk,
} from "../types";

/**
 * Mock provider configuration
 */
export const mockProvider: LLMProvider = {
  id: "mock",
  name: "Mock LLM (Demo)",
  requiresAuth: false,
  models: [
    {
      id: "mock-fast",
      name: "Mock Fast",
      contextWindow: 8000,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      supportsStreaming: true,
    },
    {
      id: "mock-smart",
      name: "Mock Smart",
      contextWindow: 32000,
      inputCostPer1k: 0,
      outputCostPer1k: 0,
      supportsStreaming: true,
    },
  ],
};

/**
 * Mock responses for demonstration
 */
const MOCK_RESPONSES = [
  "This is a mock LLM provider. In a real implementation, this would connect to an actual AI service like OpenAI, Anthropic, or a local model.",
  "I can help you with various tasks:\n\n- Code generation\n- Text analysis\n- Question answering\n- Creative writing\n- And much more!",
  "The generic chat components you created work great for any chat-like interface, not just Nostr!\n\n```typescript\ninterface GenericChat {\n  protocol: string;\n  messages: Message[];\n  sendMessage: (content: string) => void;\n}\n```",
  "Key differences between Nostr chat and LLM chat:\n\n1. **Participants**: Nostr has multiple users, LLM is 1-on-1\n2. **Streaming**: LLM responses stream token-by-token\n3. **Cost tracking**: LLM has tokens and costs\n4. **Model selection**: Choose different AI models\n5. **System prompts**: Control AI behavior",
];

/**
 * Mock provider adapter
 */
export class MockProviderAdapter implements LLMProviderAdapter {
  provider = mockProvider;

  async sendMessage(
    messages: LLMMessage[],
    settings: LLMConversationSettings,
    onChunk?: (chunk: LLMStreamChunk) => void,
  ): Promise<LLMMessage> {
    // Get a mock response based on message count
    const responseIndex =
      messages.filter((m) => m.role === "user").length % MOCK_RESPONSES.length;
    const responseText = MOCK_RESPONSES[responseIndex];

    // Simulate streaming if callback provided
    if (onChunk && settings.model.includes("fast")) {
      await this.streamResponse(responseText, onChunk);
    }

    // Create response message
    const message: LLMMessage = {
      id: `msg-${Date.now()}`,
      role: "assistant",
      content: responseText,
      timestamp: Date.now() / 1000,
      model: settings.model,
      tokens: this.estimateTokens(responseText),
      cost: 0, // Mock has no cost
    };

    return message;
  }

  private async streamResponse(
    text: string,
    onChunk: (chunk: LLMStreamChunk) => void,
  ): Promise<void> {
    // Split into words for realistic streaming
    const words = text.split(" ");

    for (let i = 0; i < words.length; i++) {
      const word = i === 0 ? words[i] : " " + words[i];

      onChunk({
        content: word,
        done: i === words.length - 1,
        tokens: i === words.length - 1 ? this.estimateTokens(text) : undefined,
      });

      // Simulate network delay
      await new Promise((resolve) =>
        setTimeout(resolve, 50 + Math.random() * 100),
      );
    }
  }

  async validateAuth(_apiKey: string): Promise<boolean> {
    // Mock provider doesn't need auth
    return true;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}
