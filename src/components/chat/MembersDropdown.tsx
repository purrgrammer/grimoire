import { Bot, Users2 } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserName } from "@/components/nostr/UserName";
import { Label } from "@/components/ui/label";
import { useProfile } from "@/hooks/useProfile";
import type { Participant } from "@/types/chat";
import { groupParticipants } from "./participant-order";

interface MembersDropdownProps {
  participants: Participant[];
}

/**
 * The people in a conversation, staff first.
 *
 * Headings are rows in the same virtualized list rather than sections around
 * it: the list is 300px over a membership that can run to thousands, so a
 * section that rendered its own children would be the one part of the dropdown
 * that is not virtualized.
 */
export function MembersDropdown({ participants }: MembersDropdownProps) {
  const rows = groupParticipants(participants);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 px-1 text-muted-foreground hover:text-foreground transition-colors">
          <Users2 className="size-3" />
          <span className="text-xs">{participants.length}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Members ({participants.length})
        </div>
        <div style={{ height: "300px" }}>
          <Virtuoso
            data={rows}
            itemContent={(_index, row) =>
              row.type === "heading" ? (
                <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {row.label} — {row.count}
                </div>
              ) : (
                <MemberRow participant={row.participant} />
              )
            }
            style={{ height: "100%" }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One person. The bot mark is NIP-24's `bot` on their own kind 0 — a claim the
 * account makes about itself, not a judgement made here, which is why it is a
 * quiet icon rather than a badge beside the role.
 */
function MemberRow({ participant }: { participant: Participant }) {
  const profile = useProfile(participant.pubkey);
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors">
      <UserName
        pubkey={participant.pubkey}
        className="text-sm truncate flex-1 min-w-0"
      />
      {profile?.bot && (
        <Bot
          className="size-3 shrink-0 text-muted-foreground"
          aria-label="Automated account"
        />
      )}
      {participant.role && participant.role !== "member" && (
        <Label size="sm" className="flex-shrink-0">
          {participant.role}
        </Label>
      )}
    </div>
  );
}
