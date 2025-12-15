import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { nip19 } from "nostr-tools";
import { GitBranch, FolderGit2, Tag, Copy, CopyCheck } from "lucide-react";
import { UserName } from "../UserName";
import { EmbeddedEvent } from "../EmbeddedEvent";
import { MediaEmbed } from "../MediaEmbed";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";
import { useCopy } from "@/hooks/useCopy";
import { useGrimoire } from "@/core/state";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import type { NostrEvent } from "@/types/nostr";
import {
  getPullRequestSubject,
  getPullRequestLabels,
  getPullRequestCommitId,
  getPullRequestBranchName,
  getPullRequestCloneUrls,
  getPullRequestMergeBase,
  getPullRequestRepositoryAddress,
} from "@/lib/nip34-helpers";
import {
  getRepositoryName,
  getRepositoryIdentifier,
} from "@/lib/nip34-helpers";
import { Label } from "@/components/ui/Label";

/**
 * Component to render nostr: mentions inline
 */
function NostrMention({ href }: { href: string }) {
  const { addWindow } = useGrimoire();

  try {
    const cleanHref = href.replace(/^nostr:/, "").trim();

    if (!cleanHref.match(/^(npub|nprofile|note|nevent|naddr)/)) {
      return (
        <a
          href={href}
          className="text-accent underline decoration-dotted break-all"
          target="_blank"
          rel="noopener noreferrer"
        >
          {href}
        </a>
      );
    }

    const parsed = nip19.decode(cleanHref);

    switch (parsed.type) {
      case "npub":
        return (
          <span className="inline-flex items-center">
            <UserName
              pubkey={parsed.data}
              className="text-accent font-semibold"
            />
          </span>
        );
      case "nprofile":
        return (
          <span className="inline-flex items-center">
            <UserName
              pubkey={parsed.data.pubkey}
              className="text-accent font-semibold"
            />
          </span>
        );
      case "note":
        return (
          <EmbeddedEvent
            eventId={parsed.data}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `Event ${(id as string).slice(0, 8)}...`,
              );
            }}
          />
        );
      case "nevent":
        return (
          <EmbeddedEvent
            eventId={parsed.data.id}
            onOpen={(id) => {
              addWindow(
                "open",
                { id: id as string },
                `Event ${(id as string).slice(0, 8)}...`,
              );
            }}
          />
        );
      case "naddr":
        return (
          <EmbeddedEvent
            addressPointer={parsed.data}
            onOpen={(pointer) => {
              addWindow(
                "open",
                pointer,
                `${parsed.data.kind}:${parsed.data.identifier.slice(0, 8)}...`,
              );
            }}
          />
        );
      default:
        return <span className="text-muted-foreground">{cleanHref}</span>;
    }
  } catch (error) {
    console.error("Failed to parse nostr link:", href, error);
    return (
      <a
        href={href}
        className="text-accent underline decoration-dotted break-all"
        target="_blank"
        rel="noopener noreferrer"
      >
        {href}
      </a>
    );
  }
}

/**
 * Detail renderer for Kind 1618 - Pull Request
 * Displays full PR content with markdown rendering
 */
export function PullRequestDetailRenderer({ event }: { event: NostrEvent }) {
  const { addWindow } = useGrimoire();
  const { copy, copied } = useCopy();

  const subject = useMemo(() => getPullRequestSubject(event), [event]);
  const labels = useMemo(() => getPullRequestLabels(event), [event]);
  const commitId = useMemo(() => getPullRequestCommitId(event), [event]);
  const branchName = useMemo(() => getPullRequestBranchName(event), [event]);
  const cloneUrls = useMemo(() => getPullRequestCloneUrls(event), [event]);
  const mergeBase = useMemo(() => getPullRequestMergeBase(event), [event]);
  const repoAddress = useMemo(
    () => getPullRequestRepositoryAddress(event),
    [event],
  );

  // Parse repository address
  const repoPointer = useMemo(() => {
    if (!repoAddress) return null;
    try {
      const [kindStr, pubkey, identifier] = repoAddress.split(":");
      return {
        kind: parseInt(kindStr),
        pubkey,
        identifier,
      };
    } catch {
      return null;
    }
  }, [repoAddress]);

  // Fetch repository event
  const repoEvent = useNostrEvent(repoPointer || undefined);

  // Get repository display name
  const repoName = repoEvent
    ? getRepositoryName(repoEvent) ||
      getRepositoryIdentifier(repoEvent) ||
      "Repository"
    : repoPointer?.identifier || "Unknown Repository";

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  const handleRepoClick = () => {
    if (!repoPointer || !repoEvent) return;
    addWindow("open", { pointer: repoPointer }, `Repository: ${repoName}`);
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* PR Header */}
      <header className="flex flex-col gap-4 pb-4 border-b border-border">
        {/* Title */}
        <h1 className="text-3xl font-bold">
          {subject || "Untitled Pull Request"}
        </h1>

        {/* Repository Link */}
        {repoAddress && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Repository:</span>
            <button
              onClick={repoEvent ? handleRepoClick : undefined}
              disabled={!repoEvent}
              className={`flex items-center gap-2 font-mono ${
                repoEvent
                  ? "text-muted-foreground underline decoration-dotted cursor-crosshair hover:text-primary"
                  : "text-muted-foreground cursor-not-allowed"
              }`}
            >
              <FolderGit2 className="size-4" />
              {repoName}
            </button>
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Tag className="size-3 text-muted-foreground" />
            {labels.map((label, idx) => (
              <Label key={idx} size="md">
                {label}
              </Label>
            ))}
          </div>
        )}
      </header>

      {/* Branch and Commit Info */}
      {(branchName || commitId || mergeBase) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <GitBranch className="size-5" />
            Branch Information
          </h2>

          {/* Branch Name */}
          {branchName && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Branch:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {branchName}
              </code>
              <button
                onClick={() => copy(branchName)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy branch name"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Commit ID */}
          {commitId && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Commit:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {commitId}
              </code>
              <button
                onClick={() => copy(commitId)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy commit ID"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Merge Base */}
          {mergeBase && (
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <span className="text-sm text-muted-foreground">Merge Base:</span>
              <code className="flex-1 text-sm font-mono truncate line-clamp-1">
                {mergeBase}
              </code>
              <button
                onClick={() => copy(mergeBase)}
                className="flex-shrink-0 p-1 hover:bg-muted"
                aria-label="Copy merge base"
              >
                {copied ? (
                  <CopyCheck className="size-3 text-muted-foreground" />
                ) : (
                  <Copy className="size-3 text-muted-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Clone URLs */}
          {cloneUrls.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Clone URLs
              </h3>
              <ul className="flex flex-col gap-2">
                {cloneUrls.map((url, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-2 p-2 bg-muted/30 font-mono"
                  >
                    <code className="flex-1 text-sm break-all line-clamp-1">
                      {url}
                    </code>
                    <button
                      onClick={() => copy(url)}
                      className="flex-shrink-0 p-1 hover:bg-muted"
                      aria-label="Copy clone URL"
                    >
                      {copied ? (
                        <CopyCheck className="size-3 text-muted-foreground" />
                      ) : (
                        <Copy className="size-3 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* PR Description - Markdown */}
      {event.content ? (
        <>
          <article className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkNostrMentions]}
              skipHtml
              urlTransform={(url) => {
                if (url.startsWith("nostr:")) return url;
                return defaultUrlTransform(url);
              }}
              components={{
                img: ({ src, alt }) =>
                  src ? (
                    <MediaEmbed
                      url={src}
                      alt={alt}
                      preset="preview"
                      enableZoom
                      className="my-4"
                    />
                  ) : null,
                a: ({ href, children, ...props }) => {
                  if (!href) return null;

                  if (href.startsWith("nostr:")) {
                    return <NostrMention href={href} />;
                  }

                  return (
                    <a
                      href={href}
                      className="text-accent underline decoration-dotted"
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  );
                },
                h1: ({ ...props }) => (
                  <h1 className="text-2xl font-bold mt-8 mb-4" {...props} />
                ),
                h2: ({ ...props }) => (
                  <h2 className="text-xl font-bold mt-6 mb-3" {...props} />
                ),
                h3: ({ ...props }) => (
                  <h3 className="text-lg font-bold mt-4 mb-2" {...props} />
                ),
                p: ({ ...props }) => (
                  <p className="text-sm leading-relaxed mb-4" {...props} />
                ),
                code: ({ className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || "");
                  const language = match ? match[1] : null;
                  const code = String(children).replace(/\n$/, "");

                  // Inline code (no language)
                  if (!language) {
                    return (
                      <code
                        className="bg-muted px-0.5 py-0.5 rounded text-xs font-mono"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }

                  // Block code with syntax highlighting
                  return (
                    <SyntaxHighlight
                      code={code}
                      language={language as any}
                      className="my-4"
                    />
                  );
                },
                blockquote: ({ ...props }) => (
                  <blockquote
                    className="border-l-4 border-muted pl-4 italic text-muted-foreground my-4"
                    {...props}
                  />
                ),
                ul: ({ ...props }) => (
                  <ul
                    className="text-sm list-disc list-inside my-4 space-y-2"
                    {...props}
                  />
                ),
                ol: ({ ...props }) => (
                  <ol
                    className="text-sm list-decimal list-inside my-4 space-y-2"
                    {...props}
                  />
                ),
                hr: () => <hr className="my-4" />,
              }}
            >
              {event.content.replace(/\\n/g, "\n")}
            </ReactMarkdown>
          </article>
        </>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          (No description provided)
        </p>
      )}
    </div>
  );
}
