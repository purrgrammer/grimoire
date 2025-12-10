import { useGrimoire } from "@/core/state";
import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { UserName } from "../UserName";
import { Users, Sparkles } from "lucide-react";

/**
 * Kind 3 Renderer - Contact/Follow List
 * Shows follow count and "follows you" indicator
 */
export function Kind3Renderer({ event, showTimestamp }: BaseEventProps) {
  const { state } = useGrimoire();

  // Extract followed pubkeys from p tags
  const followedPubkeys = event.tags
    .filter((tag) => tag[0] === "p")
    .map((tag) => tag[1]);

  const followsYou = state.activeAccount?.pubkey
    ? followedPubkeys.includes(state.activeAccount.pubkey)
    : false;

  return (
    <BaseEventContainer event={event} showTimestamp={showTimestamp}>
      <div className="flex flex-col gap-2 text-xs">
        <span className="flex items-center gap-1">
          <Users className="size-3 text-muted-foreground" />
          Following {followedPubkeys.length} people
        </span>
        {followsYou && (
          <span className="flex items-center gap-1">
            <Sparkles className="size-3 text-muted-foreground" />
            Follows you
          </span>
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

  // Extract followed pubkeys from p tags
  const followedPubkeys = event.tags
    .filter((tag: string[]) => tag[0] === "p" && tag[1].length === 64)
    .map((tag: string[]) => tag[1]);

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
          <span>Following {followedPubkeys.length} people</span>
          {followsYou && (
            <span className="flex items-center gap-1">
              <Sparkles className="size-4  text-muted-foreground" />
              Follows you
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex flex-col gap-2">
          {followedPubkeys.map((pubkey: string) => (
            <div key={pubkey} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">•</span>
              <UserName pubkey={pubkey} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
