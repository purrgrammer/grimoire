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
import { Label } from "@/components/ui/Label";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";

// Map common language names to Prism-supported languages
function mapLanguage(
  lang: string | null | undefined,
):
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "bash"
  | "json"
  | "markdown"
  | "css"
  | "python"
  | "yaml"
  | "diff" {
  if (!lang) return "javascript";

  const normalized = lang.toLowerCase();

  // Direct matches
  if (
    [
      "javascript",
      "typescript",
      "jsx",
      "tsx",
      "bash",
      "json",
      "markdown",
      "css",
      "python",
      "yaml",
      "diff",
    ].includes(normalized)
  ) {
    return normalized as any;
  }

  // Common aliases
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    sh: "bash",
    shell: "bash",
    py: "python",
    md: "markdown",
    yml: "yaml",
  };

  return (aliases[normalized] as any) || "javascript";
}

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
            language={mapLanguage(language)}
            className="overflow-x-auto bg-muted/30 p-3 border border-border"
          />
        </div>
      </div>
    </BaseEventContainer>
  );
}
