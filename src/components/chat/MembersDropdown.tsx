import { Users2 } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserName } from "@/components/nostr/UserName";
import { Label } from "@/components/ui/label";
import type { Participant } from "@/types/chat";

interface MembersDropdownProps {
  participants: Participant[];
}

/**
 * MembersDropdown - Shows member count and list with roles
 * Similar to relay indicators in ReqViewer
 */
export function MembersDropdown({ participants }: MembersDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
          <Users2 className="size-3" />
          <span>{participants.length}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Members ({participants.length})
        </div>
        <div style={{ height: "300px" }}>
          <Virtuoso
            data={participants}
            itemContent={(_index, participant) => (
              <div
                key={participant.pubkey}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors"
              >
                <UserName
                  pubkey={participant.pubkey}
                  className="text-sm truncate flex-1 min-w-0"
                />
                {participant.role && participant.role !== "member" && (
                  <Label size="sm" className="flex-shrink-0">
                    {participant.role}
                  </Label>
                )}
              </div>
            )}
            style={{ height: "100%" }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
