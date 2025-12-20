import * as React from "react";
import { ChevronsUpDown, User, Users } from "lucide-react";
import { Command } from "cmdk";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import db, { Profile } from "@/services/db";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getTagValues, getDisplayName } from "@/lib/nostr-utils";

interface ProfileSelectorProps {
  onSelect: (value: string) => void;
  showShortcuts?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * ProfileSelector - A searchable combobox for Nostr profiles
 * Autocompletes from locally cached profiles in IndexedDB
 * Supports $me and $contacts shortcuts
 */
export function ProfileSelector({
  onSelect,
  showShortcuts = true,
  className,
  placeholder = "Select person...",
}: ProfileSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [results, setResults] = React.useState<Profile[]>([]);
  const { state } = useGrimoire();

  const accountPubkey = state.activeAccount?.pubkey;

  // Fetch contacts for shortcut count and validation
  const contactListEvent = useNostrEvent(
    showShortcuts && accountPubkey
      ? { kind: 3, pubkey: accountPubkey, identifier: "" }
      : undefined,
  );

  const contacts = React.useMemo(
    () =>
      contactListEvent
        ? getTagValues(contactListEvent, "p").filter((pk) => pk.length === 64)
        : [],
    [contactListEvent],
  );

  // Search profiles when search changes
  React.useEffect(() => {
    if (!search || search.length < 1) {
      setResults([]);
      return;
    }

    const lowerSearch = search.toLowerCase();

    // Query Dexie profiles table
    // Note: This is a full scan filter, but acceptable for local cache sizes
    db.profiles
      .filter((p) => {
        const displayName = p.display_name?.toLowerCase() || "";
        const name = p.name?.toLowerCase() || "";
        const about = p.about?.toLowerCase() || "";
        const lud16 = p.lud16?.toLowerCase() || "";
        const pubkey = p.pubkey.toLowerCase();

        return (
          displayName.includes(lowerSearch) ||
          name.includes(lowerSearch) ||
          about.includes(lowerSearch) ||
          lud16.includes(lowerSearch) ||
          pubkey.startsWith(lowerSearch)
        );
      })
      .limit(20)
      .toArray()
      .then((matches) => {
        // Sort matches by priority: contacts first, then display_name/name, then about, then lud16
        const sorted = matches.sort((a, b) => {
          // 0. Contact priority
          const aIsContact = contacts.includes(a.pubkey);
          const bIsContact = contacts.includes(b.pubkey);
          if (aIsContact && !bIsContact) return -1;
          if (!aIsContact && bIsContact) return 1;

          const aDisplayName = a.display_name?.toLowerCase() || "";
          const bDisplayName = b.display_name?.toLowerCase() || "";
          const aName = a.name?.toLowerCase() || "";
          const bName = b.name?.toLowerCase() || "";
          const aAbout = a.about?.toLowerCase() || "";
          const bAbout = b.about?.toLowerCase() || "";
          const aLud = a.lud16?.toLowerCase() || "";
          const bLud = b.lud16?.toLowerCase() || "";

          // 1. Display Name / Name priority
          const aHasNameMatch =
            aDisplayName.includes(lowerSearch) || aName.includes(lowerSearch);
          const bHasNameMatch =
            bDisplayName.includes(lowerSearch) || bName.includes(lowerSearch);
          if (aHasNameMatch && !bHasNameMatch) return -1;
          if (!aHasNameMatch && bHasNameMatch) return 1;

          // 2. Description (About) priority
          const aHasAboutMatch = aAbout.includes(lowerSearch);
          const bHasAboutMatch = bAbout.includes(lowerSearch);
          if (aHasAboutMatch && !bHasAboutMatch) return -1;
          if (!aHasAboutMatch && bHasAboutMatch) return 1;

          // 3. Lud16 priority
          const aHasLudMatch = aLud.includes(lowerSearch);
          const bHasLudMatch = bLud.includes(lowerSearch);
          if (aHasLudMatch && !bHasLudMatch) return -1;
          if (!aHasLudMatch && bHasLudMatch) return 1;

          return 0;
        });
        setResults(sorted);
      });
  }, [search, contacts]);

  const handleSelect = (value: string) => {
    onSelect(value);
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-full justify-between ${className}`}
        >
          <span className="truncate">{placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command
          className="h-full w-full overflow-hidden rounded-md bg-popover text-popover-foreground"
          shouldFilter={false}
          loop
        >
          <div
            className="flex items-center border-b px-3"
            cmdk-input-wrapper=""
          >
            <Command.Input
              placeholder="Search name, bio, lud16..."
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              value={search}
              onValueChange={setSearch}
            />
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
            <Command.Empty className="py-6 text-center text-sm">
              No profiles found in cache.
            </Command.Empty>

            {showShortcuts && !search && (
              <Command.Group heading="Shortcuts">
                {accountPubkey && (
                  <Command.Item
                    onSelect={() => handleSelect("$me")}
                    className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-muted/30"
                  >
                    <User className="mr-2 h-4 w-4" />
                    <div className="flex flex-col">
                      <span className="font-medium">My Profile</span>
                      <span className="text-xs text-muted-foreground font-mono">
                        $me
                      </span>
                    </div>
                  </Command.Item>
                )}
                {contacts.length > 0 && (
                  <Command.Item
                    onSelect={() => handleSelect("$contacts")}
                    className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-muted/30"
                  >
                    <Users className="mr-2 h-4 w-4" />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        My Contacts ({contacts.length})
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        $contacts
                      </span>
                    </div>
                  </Command.Item>
                )}
              </Command.Group>
            )}

            {results.length > 0 && (
              <Command.Group>
                {results.map((profile) => (
                  <Command.Item
                    key={profile.pubkey}
                    onSelect={() => handleSelect(profile.pubkey)}
                    className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-muted/30"
                  >
                    <div className="flex flex-col w-full min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">
                          {getDisplayName(profile.pubkey, profile)}
                        </span>
                      </div>
                      {profile.about && (
                        <span className="text-xs text-muted-foreground truncate">
                          {profile.about}
                        </span>
                      )}
                      {profile.lud16 && (
                        <span className="text-[10px] text-accent truncate">
                          {profile.lud16}
                        </span>
                      )}
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
