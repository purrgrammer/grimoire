import { getKindInfo } from "@/constants/kinds";
import Command from "./Command";
import { ExternalLink } from "lucide-react";

export default function KindRenderer({ kind }: { kind: number }) {
  const kindInfo = getKindInfo(kind);
  const Icon = kindInfo?.icon;
  const category = getKindCategory(kind);
  const eventType = getEventType(kind);

  if (!kindInfo) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="text-lg font-semibold mb-2">Kind {kind}</div>
          <p className="text-sm text-muted-foreground">
            This event kind is not yet documented in Grimoire.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="w-14 h-14 bg-accent/20 rounded flex items-center justify-center flex-shrink-0">
            <Icon className="w-8 h-8 text-accent" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">{kindInfo.name}</h1>
          <p className="text-muted-foreground">{kindInfo.description}</p>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="text-muted-foreground">Kind Number</div>
        <code className="font-mono">{kind}</code>

        <div className="text-muted-foreground">Category</div>
        <div>{category}</div>

        <div className="text-muted-foreground">Event Type</div>
        <div>{eventType}</div>

        <div className="text-muted-foreground">Storage</div>
        <div>
          {kind >= 20000 && kind < 30000
            ? "Not stored (ephemeral)"
            : "Stored by relays"}
        </div>

        {kind >= 30000 && kind < 40000 && (
          <>
            <div className="text-muted-foreground">Identifier</div>
            <code className="font-mono text-xs">d-tag</code>
          </>
        )}

        {kindInfo.nip && (
          <>
            <div className="text-muted-foreground">Defined in</div>
            <div>
              <Command
                name={`NIP-${kindInfo.nip}`}
                description={`View NIP-${kindInfo.nip} specification`}
                appId="nip"
                props={{ number: kindInfo.nip }}
              />
            </div>
          </>
        )}
      </div>

      {/* GitHub Link */}
      {kindInfo.nip && (
        <div className="pt-4 border-t border-border">
          <a
            href={`https://github.com/nostr-protocol/nips/blob/master/${kindInfo.nip.padStart(
              2,
              "0",
            )}.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Get the category of an event kind
 */
function getKindCategory(kind: number): string {
  if (kind >= 0 && kind <= 10) return "Core Protocol";
  if (kind >= 11 && kind <= 19) return "Communication";
  if (kind >= 20 && kind <= 39) return "Media & Content";
  if (kind >= 40 && kind <= 49) return "Channels";
  if (kind >= 1000 && kind <= 9999) return "Application Specific";
  if (kind >= 10000 && kind <= 19999) return "Regular Lists";
  if (kind >= 20000 && kind <= 29999) return "Ephemeral Events";
  if (kind >= 30000 && kind <= 39999) return "Parameterized Replaceable";
  if (kind >= 40000) return "Custom/Experimental";
  return "Other";
}

/**
 * Determine the replaceability of an event kind
 */
function getEventType(kind: number): string {
  if (kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)) {
    return "Replaceable";
  }
  if (kind >= 30000 && kind < 40000) {
    return "Parameterized Replaceable";
  }
  if (kind >= 20000 && kind < 30000) {
    return "Ephemeral";
  }
  return "Regular";
}
