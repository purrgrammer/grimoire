import { useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  subscribeNappletIntentChoice,
  type NappletIntentChoice,
} from "@/services/napplet-intent";

function ChooserDialog({ choice }: { choice: NappletIntentChoice }) {
  const [selected, setSelected] = useState(choice.candidates[0]?.dTag ?? "");
  const [remember, setRemember] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && choice.resolve(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-5 text-muted-foreground" />
            Open with…
          </DialogTitle>
          <DialogDescription>
            {/* The sender is the runtime-attested dTag, not anything the
                calling napplet supplied. */}
            <span className="font-medium text-foreground">{choice.sender}</span>{" "}
            wants to open something that handles{" "}
            <span className="font-mono">{choice.archetype}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {choice.candidates.map((candidate) => (
            <label
              key={candidate.dTag}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/40"
            >
              <input
                type="radio"
                name="intent-handler"
                className="accent-primary"
                checked={selected === candidate.dTag}
                onChange={() => setSelected(candidate.dTag)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {candidate.title || candidate.dTag}
                </span>
                <span className="block font-mono text-[11px] text-muted-foreground/70">
                  {candidate.dTag}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id="intent-remember"
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          <label
            htmlFor="intent-remember"
            className="cursor-pointer text-xs text-muted-foreground"
          >
            Always use this for {choice.archetype}
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => choice.resolve(null)}>
            Cancel
          </Button>
          <Button
            disabled={!selected}
            onClick={() => choice.resolve({ dTag: selected, remember })}
          >
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The "open with…" chooser for NAP-INTENT.
 *
 * Shown when a napplet asks for `handler: "choose"`, or when no default exists
 * and more than one installed napplet can handle the archetype. Setting a
 * default is only possible from here — a napplet cannot change one.
 */
export function NappletIntentChooser() {
  const [choices, setChoices] = useState<NappletIntentChoice[]>([]);

  useEffect(() => subscribeNappletIntentChoice(setChoices), []);

  // Serial: two concurrent choosers could not be attributed to their callers.
  const current = choices[0];
  return current ? <ChooserDialog key={current.key} choice={current} /> : null;
}
