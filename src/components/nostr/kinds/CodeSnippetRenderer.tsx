import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getCodeLanguage,
  getCodeName,
  getCodeDescription,
} from "@/lib/nip-c0-helpers";
import { Label } from "@/components/ui/label";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";

/**
 * Renderer for Kind 1337 - Code Snippet (NIP-C0)
 * Displays code snippet name, language, description, and preview in feed
 */
export function Kind1337Renderer({ event }: BaseEventProps) {
  const name = getCodeName(event);
  const language = getCodeLanguage(event);
  const description = getCodeDescription(event);

  // Get first 5 lines for preview
  const codeLines = event.content.split("\n");
  const previewLines = codeLines.slice(0, 5);
  const hasMore = codeLines.length > 5;
  const previewCode = previewLines.join("\n") + (hasMore ? "\n..." : "");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {/* Title */}
          <ClickableEventTitle
            event={event}
            className="text-lg font-semibold text-foreground"
          >
            {name || "Code Snippet"}
          </ClickableEventTitle>

          {/* Language Badge */}
          {language && (
            <div className="flex items-center gap-2">
              <Label>{language}</Label>
            </div>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}

        {/* Code Preview */}
        <div className="relative">
          <SyntaxHighlight
            code={previewCode}
            language={language}
            className="overflow-x-auto bg-muted/30 p-3 border border-border"
          />
        </div>
      </div>
    </BaseEventContainer>
  );
}
