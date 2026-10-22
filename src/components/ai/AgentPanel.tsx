import {
  Agent,
  AgentContent,
  AgentHeader,
  AgentInstructions,
  AgentTool,
  AgentTools,
} from "@/components/ai-elements/agent";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { HEX_NAME } from "./Hex";

import { canonicalId } from "@/lib/ai-registry";
import { cn } from "@/lib/utils";

import type { ToolSupport } from "@/services/inference";
import type { InferenceFunctionTool } from "@/types/inference";

function firstSentence(text?: string): string {
  if (!text) return "";
  const end = text.indexOf(". ");
  return end === -1 ? text : `${text.slice(0, end)}.`;
}

/**
 * Who is answering, with which instructions and tools — ai-elements' `Agent`,
 * fed from IPA.
 *
 * It exists because grounding and capability are otherwise invisible: the window
 * silently prepends event JSON and NIP text, and the permission dialog lists
 * only tool names. This is the page showing what it said on the user's behalf,
 * and what it offered.
 */
export function AgentPanel({
  className,
  instructions,
  model,
  toolSupport,
  tools,
}: {
  className?: string;
  instructions?: string;
  /** From the last `done` chunk; the extension chooses it, not grimoire. */
  model?: string;
  toolSupport: ToolSupport;
  tools: InferenceFunctionTool[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Agent className={className}>
      {/* Collapsed to its header by default: who is answering is worth a line,
          and the instructions and every tool schema underneath are worth a
          screen — which is a screen the conversation needed. */}
      <Collapsible onOpenChange={setOpen} open={open}>
        <CollapsibleTrigger className="w-full cursor-pointer text-left">
          <AgentHeader model={model} name={HEX_NAME}>
            <ChevronDownIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </AgentHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <AgentContent>
            {instructions && (
              <Accordion collapsible type="single">
                <AccordionItem className="border-b-0" value="instructions">
                  {/* Matches the "Tools" heading AgentTools renders. */}
                  <AccordionTrigger className="py-0 font-medium text-muted-foreground text-sm hover:no-underline">
                    Instructions
                  </AccordionTrigger>
                  <AccordionContent>
                    {/* Verbatim, not summarised: this is what was sent. */}
                    <AgentInstructions className="max-h-64 overflow-auto text-xs [&_p]:text-xs">
                      {instructions}
                    </AgentInstructions>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {tools.length > 0 && toolSupport === "none" && (
              <Badge className="w-fit" variant="secondary">
                tools not sent
              </Badge>
            )}

            {tools.length > 0 && (
              <AgentTools collapsible type="single">
                {tools.map((tool) => (
                  <AgentTool
                    key={tool.function.name}
                    tool={{
                      // First sentence only: the whole description is several
                      // lines, and the row is a label, not the documentation.
                      description: `${canonicalId(tool.function.name)} — ${firstSentence(tool.function.description)}`,
                      jsonSchema: tool.function.parameters,
                    }}
                    value={tool.function.name}
                  />
                ))}
              </AgentTools>
            )}
          </AgentContent>
        </CollapsibleContent>
      </Collapsible>
    </Agent>
  );
}
