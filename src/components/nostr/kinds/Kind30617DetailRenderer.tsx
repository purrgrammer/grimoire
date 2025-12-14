import { useMemo } from "react";
import { Globe, Copy, Users, CopyCheck, Server } from "lucide-react";
import { UserName } from "../UserName";
import { RelayLink } from "../RelayLink";
import { useCopy } from "@/hooks/useCopy";
import type { NostrEvent } from "@/types/nostr";
import {
  getRepositoryName,
  getRepositoryDescription,
  getRepositoryIdentifier,
  getCloneUrls,
  getWebUrls,
  getMaintainers,
  getRepositoryRelays,
} from "@/lib/nip34-helpers";

/**
 * Detail renderer for Kind 30617 - Repository
 * Displays full repository metadata with all URLs and maintainers
 */
export function Kind30617DetailRenderer({ event }: { event: NostrEvent }) {
  const name = useMemo(() => getRepositoryName(event), [event]);
  const description = useMemo(() => getRepositoryDescription(event), [event]);
  const identifier = useMemo(() => getRepositoryIdentifier(event), [event]);
  const webUrls = useMemo(() => getWebUrls(event), [event]);
  const cloneUrls = useMemo(() => getCloneUrls(event), [event]);
  const maintainers = useMemo(() => getMaintainers(event), [event]);
  const relays = useMemo(() => getRepositoryRelays(event), [event]);

  const displayName = name || identifier || "Repository";

  return (
    <div className="flex flex-col gap-4 p-4 max-w-3xl mx-auto">
      {/* Repository Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-4">
        {/* Name */}
        <h1 className="text-3xl font-bold">{displayName}</h1>

        {/* Identifier */}
        {identifier && (
          <code className="text-sm text-muted-foreground font-mono bg-muted px-2 py-1 w-fit">
            <UserName pubkey={event.pubkey} />/{identifier}
          </code>
        )}

        {/* Description */}
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </header>

      {/* URLs Section */}
      {(webUrls.length > 0 || cloneUrls.length > 0) && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Globe className="size-5" />
            URLs
          </h2>

          {/* Web URLs */}
          {webUrls.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Website
              </h3>
              <ul className="flex flex-col gap-2">
                {webUrls.map((url, idx) => (
                  <UrlItem key={idx} url={url} />
                ))}
              </ul>
            </div>
          )}

          {/* Clone URLs */}
          {cloneUrls.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                git URLs
              </h3>
              <ul className="flex flex-col gap-2">
                {cloneUrls.map((url, idx) => (
                  <CloneUrlItem key={idx} url={url} />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Maintainers Section */}
      {maintainers.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Users className="size-5" />
            Maintainers
          </h2>
          <div className="flex flex-wrap gap-3">
            {maintainers.map((pubkey) => (
              <UserName
                key={pubkey}
                pubkey={pubkey}
                className="font-semibold"
              />
            ))}
          </div>
        </section>
      )}

      {/* Relay Hints Section */}
      {relays.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Server className="size-5" />
            Relays
          </h2>
          <ul className="flex flex-col gap-2">
            {relays.map((url) => (
              <li key={url} className="flex items-center gap-2">
                <RelayLink
                  url={url}
                  showInboxOutbox={false}
                  className="hover:bg-background hover:underline hover:decoration-dotted"
                  urlClassname="text-sm"
                  iconClassname="size-3"
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Component to display a web URL with copy button
 */
function UrlItem({ url }: { url: string }) {
  const { copy, copied } = useCopy();

  return (
    <li className="flex items-center gap-2 p-2 bg-muted/30 group">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-sm text-muted-foreground hover:underline hover:decoration-dotted cursor-crosshair line-clamp-1 break-all"
      >
        {url}
      </a>
      <button
        onClick={() => copy(url)}
        className="flex-shrink-0 p-1 hover:bg-muted"
        aria-label="Copy URL"
      >
        {copied ? (
          <CopyCheck className="size-3 text-muted-foreground" />
        ) : (
          <Copy className="size-3 text-muted-foreground" />
        )}
      </button>
    </li>
  );
}

/**
 * Component to display a clone URL with copy button
 */
function CloneUrlItem({ url }: { url: string }) {
  const { copy, copied } = useCopy();

  return (
    <li className="flex items-center gap-2 p-2 bg-muted/30 font-mono group">
      <code className="flex-1 text-sm text-muted-foreground break-all line-clamp-1">
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
  );
}
