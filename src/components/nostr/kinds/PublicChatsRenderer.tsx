import { BaseEventProps, BaseEventContainer } from "./BaseEventRenderer";
import { GroupLink } from "../GroupLink";

/**
 * Extract group references from a kind 10009 event
 * Groups are stored in "group" tags: ["group", "<group-id>", "<relay-url>", ...]
 */
function extractGroups(event: { tags: string[][] }): Array<{
  groupId: string;
  relayUrl: string;
}> {
  const groups: Array<{ groupId: string; relayUrl: string }> = [];

  for (const tag of event.tags) {
    if (tag[0] === "group" && tag[1] && tag[2]) {
      groups.push({
        groupId: tag[1],
        relayUrl: tag[2],
      });
    }
  }

  return groups;
}

/**
 * Public Chats Renderer (Kind 10009)
 * NIP-51 list of NIP-29 groups
 * Displays each group as a clickable link with icon and name
 */
export function PublicChatsRenderer({ event }: BaseEventProps) {
  const groups = extractGroups(event);

  if (groups.length === 0) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-xs text-muted-foreground italic">
          No public chats configured
        </div>
      </BaseEventContainer>
    );
  }

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-0.5">
        {groups.map((group) => (
          <GroupLink
            key={`${group.relayUrl}'${group.groupId}`}
            groupId={group.groupId}
            relayUrl={group.relayUrl}
          />
        ))}
      </div>
    </BaseEventContainer>
  );
}
