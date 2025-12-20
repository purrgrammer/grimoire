import * as React from "react";
import { ChevronsUpDown, Plus } from "lucide-react";
import { Command } from "cmdk";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EVENT_KINDS } from "@/constants/kinds";

interface KindSelectorProps {
  onSelect: (kind: number) => void;
  exclude?: number[];
}

export function KindSelector({ onSelect, exclude = [] }: KindSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [search, setSearch] = React.useState("");

  const knownKinds = React.useMemo(() => {
    return Object.values(EVENT_KINDS)
      .filter((k) => typeof k.kind === "number")
      .map((k) => ({
        value: k.kind.toString(),
        label: k.name,
        kind: k.kind as number,
        description: k.description,
      }))
      .filter((k) => !exclude.includes(k.kind))
      .sort((a, b) => a.kind - b.kind);
  }, [exclude]);

  const filteredKinds = React.useMemo(() => {
    if (!search) return knownKinds;
    const lowerSearch = search.toLowerCase();
    return knownKinds.filter(
      (k) =>
        k.value.includes(lowerSearch) ||
        k.label.toLowerCase().includes(lowerSearch) ||
        k.description.toLowerCase().includes(lowerSearch),
    );
  }, [knownKinds, search]);

  const isCustomNumber =
    search &&
    !isNaN(parseInt(search)) &&
    !knownKinds.find((k) => k.value === search) &&
    !exclude.includes(parseInt(search));

  const handleSelect = (currentValue: string) => {
    const kind = parseInt(currentValue);
    if (!isNaN(kind)) {
      onSelect(kind);
      setValue("");
      setSearch("");
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value
            ? knownKinds.find((k) => k.value === value)?.label || value
            : "Select kind..."}
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
              placeholder="Search kind name or number..."
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              value={search}
              onValueChange={setSearch}
            />
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1">
            <Command.Empty className="py-6 text-center text-sm">
              No kind found.
            </Command.Empty>
            {isCustomNumber && (
              <Command.Item
                value={search}
                onSelect={() => handleSelect(search)}
                className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-muted/30"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Kind {search}
              </Command.Item>
            )}
            {filteredKinds.map((kind) => (
              <Command.Item
                key={kind.value}
                value={kind.value + " " + kind.label}
                onSelect={() => handleSelect(kind.value)}
                className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-muted/30"
              >
                <div className="flex flex-col w-full">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{kind.label}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {kind.value}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate">
                    {kind.description}
                  </span>
                </div>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
