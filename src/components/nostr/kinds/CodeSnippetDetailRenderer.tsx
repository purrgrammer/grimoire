import { useMemo } from "react";
import { NostrEvent } from "@/types/nostr";
import { ExternalLink } from "lucide-react";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import {
  getCodeLanguage,
  getCodeName,
  getCodeExtension,
  getCodeDescription,
  getCodeRuntime,
  getCodeLicenses,
  getCodeDependencies,
  getCodeRepo,
} from "@/lib/nip-c0-helpers";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/label";

interface Kind1337DetailRendererProps {
  event: NostrEvent;
}

/**
 * Detail renderer for Kind 1337 - Code Snippet (NIP-C0)
 * Full view with all metadata and complete code
 * Note: NIP-C0 helpers wrap getTagValue which caches internally
 */
export function Kind1337DetailRenderer({ event }: Kind1337DetailRendererProps) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();

  // All these helpers wrap getTagValue, which caches internally
  const name = getCodeName(event);
  const language = getCodeLanguage(event);
  const extension = getCodeExtension(event);
  const description = getCodeDescription(event);
  const runtime = getCodeRuntime(event);
  const licenses = getCodeLicenses(event);
  const dependencies = getCodeDependencies(event);
  const repo = getCodeRepo(event);

  // Parse NIP-34 repository address if present
  const repoPointer = useMemo(() => {
    if (!repo || repo.type !== "nip34") return null;
    try {
      const [kindStr, pubkey, identifier] = repo.value.split(":");
      return {
        kind: parseInt(kindStr),
        pubkey,
        identifier,
      };
    } catch {
      return null;
    }
  }, [repo]);

  // Fetch repository event if NIP-34 address
  const repoEvent = useNostrEvent(repoPointer || undefined);
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) ||
      getRepositoryIdentifier(repoEvent) ||
      "Repository"
    : repo?.type === "nip34"
      ? repo.value.split(":")[2] || "Unknown Repository"
      : null;

  const handleCopyCode = () => {
    copy(event.content);
  };

  const handleRepoClick = () => {
    if (repoPointer) {
      addWindow("open", { pointer: repoPointer });
    }
  };

  // Normalize language to supported Prism languages
  const normalizedLanguage = useMemo(() => {
    if (!language) return null;
    const lang = language.toLowerCase();

    // Map common language names to Prism identifiers
    const languageMap: Record<string, string> = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      sh: "bash",
      shell: "bash",
      yml: "yaml",
    };

    const mapped = languageMap[lang] || lang;

    // Check if it's a supported language
    const supported = [
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
    ];

    return supported.includes(mapped) ? mapped : null;
  }, [language]);

  return (
    <div className="flex flex-col gap-2 p-6">
      {/* Header */}
      <h1 className="text-2xl font-bold">{name || "Code Snippet"}</h1>

      {/* Description */}
      {description && <p>{description}</p>}

      {/* Metadata Section */}
      <div className="grid grid-cols-2 gap-2 py-2 text-sm">
        {language && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Language</h3>
            <span className="font-mono">{language}</span>
          </div>
        )}
        {extension && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Extension</h3>
            <span className="font-mono">.{extension}</span>
          </div>
        )}
        {/* Runtime */}
        {runtime && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Runtime</h3>
            <span className="font-mono">{runtime}</span>
          </div>
        )}

        {/* Licenses */}
        {licenses.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">License</h3>
            <span>{licenses.join(", ")}</span>
          </div>
        )}

        {/* Dependencies */}
        {dependencies.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Dependencies</h3>
            <div className="flex gap-1 items-center flex-wrap">
              {dependencies.map((dep, idx) => (
                <Label key={idx} className="p-0.5">
                  {dep}
                </Label>
              ))}
            </div>
          </div>
        )}

        {/* Repository */}
        {repo && (
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Repository</h3>
            {repo.type === "url" ? (
              <a
                href={repo.value}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {repo.value}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              <button
                onClick={handleRepoClick}
                className="inline-flex items-center gap-1 text-primary hover:underline cursor-crosshair"
              >
                {repoName}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Code Section */}
      <div className="relative">
        {normalizedLanguage ? (
          <>
            <SyntaxHighlight
              code={event.content}
              language={normalizedLanguage as any}
              className="bg-muted p-4 pr-10 border border-border overflow-x-auto"
            />
            <CodeCopyButton
              onCopy={handleCopyCode}
              copied={copied}
              label="Copy code"
            />
          </>
        ) : (
          <pre className="text-xs font-mono bg-muted p-4 pr-10 border border-border overflow-x-auto">
            <CodeCopyButton
              onCopy={handleCopyCode}
              copied={copied}
              label="Copy code"
            />
            <code>{event.content}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
