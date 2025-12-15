import { useGrimoire } from "@/core/state";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { UserName } from "../UserName";
import { Users, Sparkles, Hash } from "lucide-react";
import { getTagValues } from "@/lib/nostr-utils";

/**
 * Kind 3 Renderer - Contact/Follow List
 * Shows follow count and "follows you" indicator
 */
export function Kind3Renderer({ event }: BaseEventProps) {
  const { state } = useGrimoire();

  const followedPubkeys = getTagValues(event, "p");
  const topics = getTagValues(event, "t");

  const followsYou = state.activeAccount?.pubkey
    ? followedPubkeys.includes(state.activeAccount.pubkey)
    : false;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-1">
          <Users className="size-4 text-muted-foreground" />
          {followedPubkeys.length} people
        </div>
        {followsYou && (
          <div className="flex items-center gap-1">
            <Sparkles className="size-4 text-muted-foreground" />
            Follows you
          </div>
        )}
        {topics.length > 0 && (
          <div className="flex items-center gap-1">
            <Hash className="size-4 text-muted-foreground" />
            {topics.length} topics
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}

/**
 * Kind 3 Detail View - Full follow list
 * Shows all followed users in order
 */
export function Kind3DetailView({ event }: { event: any }) {
  const { state } = useGrimoire();

  const followedPubkeys = getTagValues(event, "p").filter(
    (pk) => pk.length === 64,
  );
  const topics = getTagValues(event, "t");

  const followsYou = state.activeAccount?.pubkey
    ? followedPubkeys.includes(state.activeAccount.pubkey)
    : false;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Users className="size-5" />
          <span className="text-lg font-semibold">Contacts</span>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1">
            <Users className="size-4 text-muted-foreground" />
            {followedPubkeys.length} people
          </span>
          {followsYou && (
            <span className="flex items-center gap-1">
              <Sparkles className="size-4  text-muted-foreground" />
              Follows you
            </span>
          )}
          {topics.length > 0 && (
            <span className="flex items-center gap-1">
              <Hash className="size-4 text-muted-foreground" />
              {topics.length} topics
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2>People</h2>
        {followedPubkeys.map((pubkey: string) => (
          <div key={pubkey} className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">•</span>
            <UserName pubkey={pubkey} />
          </div>
        ))}
      </div>

      {topics.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2>Topics</h2>
          {topics.map((topic: string) => (
            <div key={topic} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">#{topic}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
