import type { Conversation } from "./chat";

/**
 * Context passed to action handlers
 */
export interface ChatActionContext {
  /** Active user's pubkey */
  activePubkey: string;

  /** Active user's signer */
  activeSigner: any;

  /** Conversation being acted upon */
  conversation: Conversation;
}

/**
 * Result from executing an action
 */
export interface ChatActionResult {
  success: boolean;
  message?: string;
}

/**
 * Simple chat action without parameters
 */
export interface ChatAction {
  /** Command name (e.g., "join", "leave") */
  name: string;

  /** Human-readable description */
  description: string;

  /** Handler function */
  handler: (context: ChatActionContext) => Promise<ChatActionResult>;
}

/**
 * Options for filtering available actions
 */
export interface GetActionsOptions {
  /** Current conversation */
  conversation?: Conversation;

  /** Active user's pubkey */
  activePubkey?: string;
}
