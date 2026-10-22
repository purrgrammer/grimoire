import { ChevronDown, FileText, Wrench } from "lucide-react";
import { useState } from "react";

import type { InferenceFunctionTool } from "@/types/inference";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * The system prompt, verbatim and collapsed.
 *
 * Grounding is invisible by construction: the window silently prepends event
 * JSON, kind metadata, and NIP text to what the user typed. If the page is
 * going to speak on the user's behalf it has to show exactly what it said, so
 * this is the sent text — not a summary of it.
 */
export function SystemPromptDisclosure({
  className,
  prompt,
}: {
  className?: string;
  prompt: string;
}) {
  const [open, setOpen] = useState(false);
  const lines = prompt.split("\n").length;

  return (
    <Collapsible
      className={cn("rounded border border-dashed border-border", className)}
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <FileText className="size-3" />
        <span>
          System prompt · {lines} {lines === 1 ? "line" : "lines"}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          {prompt}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The tools Hex was offered, with their argument schemas.
 *
 * Same reasoning as the prompt disclosure: these are capabilities handed to a
 * model on the user's behalf, and the permission prompt lists only the names.
 * The schemas say what could actually be asked for.
 */
export function ToolsDisclosure({
  className,
  offered,
  tools,
}: {
  className?: string;
  /**
   * Whether the tools were actually sent. Shown either way: "what could Hex
   * ask for" is worth seeing even when the injector does not advertise tool
   * calling, and hiding it made the answer to "do we pass tools?" invisible.
   */
  offered: boolean;
  tools: InferenceFunctionTool[];
}) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;

  return (
    <Collapsible
      className={cn("rounded border border-dashed border-border", className)}
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Wrench className="size-3" />
        <span className="truncate">
          Tools · {tools.map((tool) => tool.function.name).join(", ")}
          {!offered && " · not sent"}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto size-3 transition-transform",
            open ? "rotate-180" : "rotate-0",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t border-dashed border-border px-2 py-2">
        {!offered && (
          <p className="text-xs text-muted-foreground">
            Your provider does not advertise tool calling, so these are not sent
            — sending them anyway is an invalid request. Hex proposes commands
            for you to run instead.
          </p>
        )}
        {tools.map((tool) => (
          <div key={tool.function.name}>
            <div className="font-mono text-xs">{tool.function.name}</div>
            {tool.function.description && (
              <p className="text-xs text-muted-foreground">
                {tool.function.description}
              </p>
            )}
            {tool.function.parameters && (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {JSON.stringify(tool.function.parameters, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
