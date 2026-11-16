import type { IncompleteRelayReadError } from "@/lib/relay-subscription";

/**
 * Toast copy for a page of chat history no relay finished serving.
 *
 * Shared by "load older" and jump-to-message, which both used to read an
 * unanswered page as the start of the conversation.
 */
export function describeIncompleteRead(
  error: IncompleteRelayReadError,
): string {
  if (error.authRequired.length > 0) {
    return `Couldn't load older messages: ${error.authRequired.join(", ")} requires authentication.`;
  }
  return "Couldn't load older messages: no relay finished answering. Try again.";
}
