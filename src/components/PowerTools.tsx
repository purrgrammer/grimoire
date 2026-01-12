import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Hash, AtSign, Code, Link } from "lucide-react";
import { useProfileSearch } from "@/hooks/useProfileSearch";
import type { ProfileSearchResult } from "@/services/profile-search";
import { nip19 } from "nostr-tools";

export interface PowerToolsProps {
  /** Callback when a tool action is triggered */
  onInsert?: (text: string) => void;
  /** Callback when a mention is added */
  onAddMention?: (pubkey: string) => void;
}

/**
 * Power tools for quick formatting and insertions
 *
 * Provides quick access to:
 * - Hashtags
 * - Mentions
 * - Formatting (code, links)
 * - Quick snippets
 */
export function PowerTools({ onInsert, onAddMention }: PowerToolsProps) {
  const [hashtagInput, setHashtagInput] = useState("");
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionResults, setMentionResults] = useState<ProfileSearchResult[]>(
    [],
  );
  const { searchProfiles } = useProfileSearch();

  // Handle hashtag insert
  const handleHashtagInsert = useCallback(() => {
    if (!hashtagInput.trim()) return;
    const tag = hashtagInput.trim().replace(/^#/, "");
    onInsert?.(`#${tag} `);
    setHashtagInput("");
  }, [hashtagInput, onInsert]);

  // Handle mention search
  const handleMentionSearch = useCallback(
    async (query: string) => {
      setMentionQuery(query);
      if (query.trim()) {
        const results = await searchProfiles(query);
        setMentionResults(results.slice(0, 5));
      } else {
        setMentionResults([]);
      }
    },
    [searchProfiles],
  );

  // Handle mention select
  const handleMentionSelect = useCallback(
    (result: ProfileSearchResult) => {
      try {
        const npub = nip19.npubEncode(result.pubkey);
        onInsert?.(`nostr:${npub} `);
        onAddMention?.(result.pubkey);
        setMentionQuery("");
        setMentionResults([]);
      } catch (error) {
        console.error("Failed to encode npub:", error);
      }
    },
    [onInsert, onAddMention],
  );

  return (
    <div className="flex items-center gap-1">
      {/* Hashtag Tool */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Add hashtag"
          >
            <Hash className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="space-y-2">
            <div className="text-sm font-medium">Add Hashtag</div>
            <div className="flex gap-2">
              <Input
                placeholder="Enter tag..."
                value={hashtagInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setHashtagInput(e.target.value)
                }
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    handleHashtagInsert();
                  }
                }}
                className="text-sm"
              />
              <Button size="sm" onClick={handleHashtagInsert}>
                Add
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Mention Tool */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title="Add mention"
          >
            <AtSign className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-2">
            <div className="text-sm font-medium">Add Mention</div>
            <Input
              placeholder="Search profiles..."
              value={mentionQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleMentionSearch(e.target.value)
              }
              className="text-sm"
            />

            {/* Results */}
            {mentionResults.length > 0 && (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {mentionResults.map((result: ProfileSearchResult) => (
                  <button
                    key={result.pubkey}
                    className="w-full text-left p-2 rounded hover:bg-muted transition-colors"
                    onClick={() => handleMentionSelect(result)}
                  >
                    <div className="text-sm font-medium">
                      {result.displayName}
                    </div>
                    {result.nip05 && (
                      <div className="text-xs text-muted-foreground">
                        {result.nip05}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Code Snippet */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        title="Insert code block"
        onClick={() => onInsert?.("```\n\n```")}
      >
        <Code className="w-4 h-4" />
      </Button>

      {/* Link */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        title="Insert link"
        onClick={() => onInsert?.("[text](url)")}
      >
        <Link className="w-4 h-4" />
      </Button>
    </div>
  );
}
