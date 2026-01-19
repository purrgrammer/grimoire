/**
 * React hooks for accessing NIP-17 gift wrap data
 */

import { useState, useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import giftWrapManager, { type GiftWrapStats } from "@/services/gift-wrap";
import type { UnsealedDM } from "@/services/db";
import accountManager from "@/services/accounts";

/**
 * Hook to access gift wrap statistics
 * Returns real-time stats about decryption success/failure rates
 */
export function useGiftWrapStats(): GiftWrapStats {
  const [stats, setStats] = useState<GiftWrapStats>({
    totalGiftWraps: 0,
    successfulDecryptions: 0,
    failedDecryptions: 0,
    pendingDecryptions: 0,
  });

  useEffect(() => {
    const subscription = giftWrapManager.getStats().subscribe(setStats);
    return () => subscription.unsubscribe();
  }, []);

  return stats;
}

/**
 * Hook to get all conversations for the active account
 * Returns a map of conversation keys to the latest message in each conversation
 */
export function useGiftWrapConversations(): Map<string, UnsealedDM> | null {
  const [conversations, setConversations] = useState<Map<
    string,
    UnsealedDM
  > | null>(null);
  const activeAccount = use$(accountManager.active$);

  useEffect(() => {
    if (!activeAccount?.pubkey) {
      setConversations(null);
      return;
    }

    // Load conversations from storage
    giftWrapManager
      .getConversations(activeAccount.pubkey)
      .then(setConversations)
      .catch((error) => {
        console.error("[useGiftWrapConversations] Failed to load:", error);
        setConversations(new Map());
      });

    // Poll for updates every 5 seconds
    // TODO: Replace with proper reactive subscription when gift wrap manager emits updates
    const interval = setInterval(() => {
      giftWrapManager
        .getConversations(activeAccount.pubkey)
        .then(setConversations)
        .catch(console.error);
    }, 5000);

    return () => clearInterval(interval);
  }, [activeAccount?.pubkey]);

  return conversations;
}

/**
 * Hook to get messages for a specific conversation
 */
export function useConversationMessages(
  conversationKey: string | null,
): UnsealedDM[] | null {
  const [messages, setMessages] = useState<UnsealedDM[] | null>(null);

  useEffect(() => {
    if (!conversationKey) {
      setMessages(null);
      return;
    }

    // Load messages from storage
    giftWrapManager
      .getConversationMessages(conversationKey)
      .then(setMessages)
      .catch((error) => {
        console.error("[useConversationMessages] Failed to load:", error);
        setMessages([]);
      });

    // Poll for updates every 3 seconds
    // TODO: Replace with proper reactive subscription
    const interval = setInterval(() => {
      giftWrapManager
        .getConversationMessages(conversationKey)
        .then(setMessages)
        .catch(console.error);
    }, 3000);

    return () => clearInterval(interval);
  }, [conversationKey]);

  return messages;
}
