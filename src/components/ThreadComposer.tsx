import { useState, useRef, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import { Button } from "./ui/button";
import { Loader2, X } from "lucide-react";
import {
  MentionEditor,
  type MentionEditorHandle,
} from "./editor/MentionEditor";
import type { NostrEvent } from "@/types/nostr";
import { publishEventToRelays } from "@/services/hub";
import { toast } from "sonner";
import { UserName } from "./nostr/UserName";
import { EventFactory } from "applesauce-core";
import accountManager from "@/services/accounts";
import type { ProfileSearchResult } from "@/services/profile-search";
import { getDisplayName } from "@/lib/nostr-utils";

interface ThreadComposerProps {
  rootEvent: NostrEvent;
  replyToEvent: NostrEvent;
  participants: string[]; // All thread participants for autocomplete
  onCancel: () => void;
  onSuccess: () => void;
}

/**
 * ThreadComposer - Inline composer for replying to thread comments
 * - Posts kind 1111 (NIP-22 comments)
 * - Autocomplete from thread participants
 * - Shows preview of comment being replied to
 */
export function ThreadComposer({
  rootEvent,
  replyToEvent,
  participants,
  onCancel,
  onSuccess,
}: ThreadComposerProps) {
  const [isSending, setIsSending] = useState(false);
  const editorRef = useRef<MentionEditorHandle>(null);
  const activeAccount = use$(accountManager.active$);

  // Search profiles for autocomplete (thread participants only)
  const searchProfiles = useMemo(() => {
    return async (query: string): Promise<ProfileSearchResult[]> => {
      if (!query) return [];

      const normalizedQuery = query.toLowerCase();

      // Filter participants that match the query
      const matches = participants
        .filter((pubkey) => {
          // TODO: Could fetch profiles and search by name
          // For now just match by pubkey prefix
          return pubkey.toLowerCase().includes(normalizedQuery);
        })
        .slice(0, 10)
        .map((pubkey) => ({
          pubkey,
          displayName: getDisplayName(pubkey, undefined),
        }));

      return matches;
    };
  }, [participants]);

  const handleSend = async (content: string) => {
    if (!activeAccount || isSending || !content.trim()) return;

    setIsSending(true);
    try {
      // Create kind 1111 comment with NIP-22 tags
      // Uppercase tags (E, A, K, P) = root
      // Lowercase tags (e, a, k, p) = parent (immediate reply)

      const rootTags: string[][] = [];
      const parentTags: string[][] = [];

      // Add root tags (uppercase)
      rootTags.push(["E", rootEvent.id]);
      rootTags.push(["K", String(rootEvent.kind)]);
      rootTags.push(["P", rootEvent.pubkey]);

      // Add parent tags (lowercase) - the comment we're replying to
      parentTags.push(["e", replyToEvent.id]);
      parentTags.push(["k", String(replyToEvent.kind)]);
      parentTags.push(["p", replyToEvent.pubkey]);

      // Also tag all mentioned participants
      const allMentionedPubkeys = [rootEvent.pubkey, replyToEvent.pubkey];
      const uniquePubkeys = Array.from(new Set(allMentionedPubkeys));

      // Create event factory and sign event
      const factory = new EventFactory();
      factory.setSigner(activeAccount.signer);

      const draft = await factory.build({
        kind: 1111,
        content: content.trim(),
        tags: [
          ...rootTags,
          ...parentTags,
          ...uniquePubkeys.map((pk) => ["p", pk]),
        ],
      });

      const event = await factory.sign(draft);

      // Publish to relays (using default relay set)
      await publishEventToRelays(event, []);

      toast.success("Reply posted!");
      onSuccess();
    } catch (error) {
      console.error("[ThreadComposer] Failed to send reply:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to post reply";
      toast.error(errorMessage);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="border-t border-border bg-muted/20 px-2 py-2">
      {/* Reply preview */}
      <div className="flex items-center justify-between gap-2 mb-2 px-2 py-1 bg-muted/30 rounded text-xs">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-muted-foreground flex-shrink-0">
            Replying to
          </span>
          <UserName
            pubkey={replyToEvent.pubkey}
            className="font-semibold flex-shrink-0"
          />
        </div>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Composer */}
      <div className="flex gap-1.5 items-center">
        <MentionEditor
          ref={editorRef}
          placeholder="Write a reply..."
          searchProfiles={searchProfiles}
          onSubmit={(content: string) => {
            if (content.trim()) {
              handleSend(content);
            }
          }}
          className="flex-1 min-w-0"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="flex-shrink-0 h-7 px-2 text-xs"
          disabled={isSending}
          onClick={() => {
            editorRef.current?.submit();
          }}
        >
          {isSending ? <Loader2 className="size-3 animate-spin" /> : "Reply"}
        </Button>
      </div>
    </div>
  );
}
