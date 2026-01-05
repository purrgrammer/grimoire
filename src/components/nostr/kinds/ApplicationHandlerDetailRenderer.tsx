import { NostrEvent } from "@/types/nostr";
import {
  getAppName,
  getAppDescription,
  getSupportedKinds,
  getPlatformUrls,
  getHandlerIdentifier,
  getAppWebsite,
} from "@/lib/nip89-helpers";
import { KindBadge } from "@/components/KindBadge";
import { Badge } from "@/components/ui/badge";
import { useCopy } from "@/hooks/useCopy";
import { UserName } from "../UserName";
import { ExternalLink } from "@/components/ExternalLink";
import {
  Copy,
  CopyCheck,
  Globe,
  Smartphone,
  TabletSmartphone,
} from "lucide-react";

interface ApplicationHandlerDetailRendererProps {
  event: NostrEvent;
}

/**
 * Get icon for platform name
 */
function PlatformIcon({ platform }: { platform: string }) {
  const lowerPlatform = platform.toLowerCase();

  if (lowerPlatform === "web") {
    return <Globe className="size-4" />;
  }
  if (lowerPlatform === "ios") {
    return <Smartphone className="size-4" />;
  }
  if (lowerPlatform === "android") {
    return <TabletSmartphone className="size-4" />;
  }

  // Default for other platforms
  return <span className="text-sm font-mono">{platform}</span>;
}

/**
 * Copy button for URL templates
 */
function CopyUrlButton({ url }: { url: string }) {
  const { copy, copied } = useCopy();

  return (
    <button
      onClick={() => copy(url)}
      className="p-1 hover:bg-muted rounded transition-colors"
      title="Copy URL template"
    >
      {copied ? (
        <CopyCheck className="size-4 text-green-500" />
      ) : (
        <Copy className="size-4 text-muted-foreground" />
      )}
    </button>
  );
}

/**
 * Detail renderer for Kind 31990 - Application Handler
 * Shows comprehensive metadata including all supported kinds and platform URLs
 * Note: NIP-89 helpers wrap getTagValue which caches internally
 */
export function ApplicationHandlerDetailRenderer({
  event,
}: ApplicationHandlerDetailRendererProps) {
  const appName = getAppName(event);
  const description = getAppDescription(event);
  const supportedKinds = getSupportedKinds(event);
  const platformUrls = getPlatformUrls(event);
  const identifier = getHandlerIdentifier(event);
  const website = getAppWebsite(event);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Section */}
      <div className="flex flex-col gap-3">
        {/* App Name */}
        <h1 className="text-3xl font-bold">{appName}</h1>

        {/* Description */}
        {description && (
          <p className="text-muted-foreground text-lg">{description}</p>
        )}

        {/* Website */}
        {website && (
          <ExternalLink href={website} variant="default" size="base">
            {website}
          </ExternalLink>
        )}

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {/* Publisher */}
          <div className="flex flex-col gap-1">
            <h3 className="text-muted-foreground">Publisher</h3>
            <UserName pubkey={event.pubkey} />
          </div>

          {/* Identifier */}
          {identifier && (
            <div className="flex flex-col gap-1">
              <h3 className="text-muted-foreground">Identifier</h3>
              <code className="font-mono text-sm">{identifier}</code>
            </div>
          )}
        </div>
      </div>

      {/* Supported Kinds Section */}
      {supportedKinds.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">
            Supported Kinds ({supportedKinds.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {supportedKinds.map((kind) => (
              <KindBadge
                key={kind}
                kind={kind}
                variant="default"
                showIcon
                showName
                clickable
                className="text-xs justify-start"
              />
            ))}
          </div>
        </div>
      )}

      {/* Platforms & URLs Section */}
      {Object.keys(platformUrls).length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Platforms & URLs</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(platformUrls).map(([platform, url]) => (
              <div
                key={platform}
                className="flex flex-col gap-2 p-3 bg-muted/30 rounded-lg border border-border"
              >
                {/* Platform Name */}
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={platform} />
                  <Badge variant="secondary" className="capitalize">
                    {platform}
                  </Badge>
                </div>

                {/* URL Template */}
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
                    {url}
                  </code>
                  <CopyUrlButton url={url} />
                </div>

                {/* Placeholder Help */}
                {url.includes("<bech32>") && (
                  <p className="text-xs text-muted-foreground">
                    The <code className="bg-muted px-1">&lt;bech32&gt;</code>{" "}
                    placeholder will be replaced with the NIP-19 encoded event
                    (nevent, naddr, note, etc.)
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
