import { getKindInfo } from "@/constants/kinds";
import Command from "./Command";

// Supported kinds with rich renderers
const SUPPORTED_KINDS = [
  0, // Profile Metadata
  1, // Short Text Note
  3, // Contact List
  6, // Repost
  7, // Reaction
  20, // Picture (NIP-68)
  21, // Video Event (NIP-71)
  22, // Short Video (NIP-71)
  1063, // File Metadata (NIP-94)
  1111, // Post
  9735, // Zap Receipt
  9802, // Highlight
  10002, // Relay List Metadata (NIP-65)
  30023, // Long-form Article
  39701, // Web Bookmarks (NIP-B0)
];

/**
 * KindsViewer - System introspection command
 * Shows all event kinds with rich rendering support
 */
export default function KindsViewer() {
  // Sort kinds in ascending order
  const sortedKinds = [...SUPPORTED_KINDS].sort((a, b) => a - b);

  return (
    <div className="h-full w-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold mb-2">
            Supported Event Kinds ({sortedKinds.length})
          </h1>
          <p className="text-sm text-muted-foreground">
            Event kinds with rich rendering support in Grimoire. Default kinds
            display raw content only.
          </p>
        </div>

        {/* Kind List */}
        <div className="border border-border divide-y divide-border">
          {sortedKinds.map((kind) => {
            const kindInfo = getKindInfo(kind);
            const Icon = kindInfo?.icon;

            return (
              <div
                key={kind}
                className="p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-10 h-10 bg-accent/20 rounded flex items-center justify-center flex-shrink-0">
                    {Icon ? (
                      <Icon className="w-5 h-5 text-accent" />
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground">
                        {kind}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <code className="text-sm font-mono font-semibold">
                        {kind}
                      </code>
                      <span className="text-sm font-semibold">
                        {kindInfo?.name || `Kind ${kind}`}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {kindInfo?.description || "No description available"}
                    </p>
                    {kindInfo?.nip && (
                      <Command
                        name={`NIP-${kindInfo.nip}`}
                        description={`View specification`}
                        appId="nip"
                        props={{ number: kindInfo.nip }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
