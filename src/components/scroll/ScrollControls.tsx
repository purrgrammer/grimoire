import { Play, Square, Loader2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type { ScrollRuntimeState } from "@/lib/scroll-runtime";

interface ScrollControlsProps {
  runtimeState: ScrollRuntimeState;
  onRun: () => void;
  onStop: () => void;
  runDisabled?: boolean;
  endianness: "LE" | "BE";
  presenceBytes: boolean;
  onEndiannessChange: (v: "LE" | "BE") => void;
  onPresenceBytesChange: (v: boolean) => void;
}

export function ScrollControls({
  runtimeState,
  onRun,
  onStop,
  runDisabled,
  endianness,
  presenceBytes,
  onEndiannessChange,
  onPresenceBytesChange,
}: ScrollControlsProps) {
  const canRun =
    runtimeState === "idle" ||
    runtimeState === "stopped" ||
    runtimeState === "completed" ||
    runtimeState === "error";
  const isActive = runtimeState === "loading" || runtimeState === "running";

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onRun} disabled={!canRun || runDisabled}>
        {isActive ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        Run
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={onStop}
        disabled={!isActive}
      >
        <Square className="size-3.5" />
        Stop
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 ml-auto"
            disabled={isActive}
          >
            <Settings className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Encoding</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={endianness}
            onValueChange={(v) => onEndiannessChange(v as "LE" | "BE")}
          >
            <DropdownMenuRadioItem value="LE">
              Little-endian (spec)
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="BE">
              Big-endian (legacy)
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={presenceBytes}
            onCheckedChange={(v) => onPresenceBytesChange(v === true)}
          >
            Presence bytes
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
