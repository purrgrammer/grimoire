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
  const [isLoading, setIsLoading] = useState(false);
  const activeAccount = use$(accountManager.active$);

  useEffect(() => {
    if (!activeAccount?.pubkey) {
      setConversations(null);
      return;
    }

    let isMounted = true;

    // Load conversations from storage
    const loadConversations = async () => {
      if (isLoading) return; // Prevent overlapping fetches

      setIsLoading(true);
      try {
        const result = await giftWrapManager.getConversations(
          activeAccount.pubkey,
        );
        if (isMounted) {
          setConversations(result);
        }
      } catch (error) {
        console.error("[useGiftWrapConversations] Failed to load:", error);
        if (isMounted) {
          setConversations(new Map());
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    // Initial load
    loadConversations();

    // Poll for updates every 5 seconds
    // TODO: Replace with proper reactive subscription when gift wrap manager emits updates
    const interval = setInterval(loadConversations, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeAccount?.pubkey]); // Removed isLoading from deps to avoid infinite loop

  return conversations;
}

/**
 * Hook to get messages for a specific conversation
 */
export function useConversationMessages(
  conversationKey: string | null,
): UnsealedDM[] | null {
  const [messages, setMessages] = useState<UnsealedDM[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!conversationKey) {
      setMessages(null);
      return;
    }

    let isMounted = true;

    // Load messages from storage
    const loadMessages = async () => {
      if (isLoading) return; // Prevent overlapping fetches

      setIsLoading(true);
      try {
        const result =
          await giftWrapManager.getConversationMessages(conversationKey);
        if (isMounted) {
          setMessages(result);
        }
      } catch (error) {
        console.error("[useConversationMessages] Failed to load:", error);
        if (isMounted) {
          setMessages([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    // Initial load
    loadMessages();

    // Poll for updates every 3 seconds
    // TODO: Replace with proper reactive subscription
    const interval = setInterval(loadMessages, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [conversationKey]); // Removed isLoading from deps to avoid infinite loop

  return messages;
}
