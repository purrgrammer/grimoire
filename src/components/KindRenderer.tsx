import { getKindInfo } from "@/constants/kinds";
import { NIPBadge } from "./NIPBadge";
import { Copy, CopyCheck } from "lucide-react";
import { Button } from "./ui/button";
import { useCopy } from "@/hooks/useCopy";
import {
  getKindSchema,
  parseTagStructure,
  getContentTypeDescription,
} from "@/lib/nostr-schema";
import { CenteredContent } from "./ui/CenteredContent";
import {
  isReplaceableKind,
  isEphemeralKind,
  isParameterizedReplaceableKind,
} from "@/lib/nostr-kinds";

export default function KindRenderer({ kind }: { kind: number }) {
  const kindInfo = getKindInfo(kind);
  const schema = getKindSchema(kind);
  const Icon = kindInfo?.icon;
  const category = getKindCategory(kind);
  const eventType = getEventType(kind);
  const { copy, copied } = useCopy();

  function copyKind() {
    copy(String(kind));
  }

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
    <CenteredContent>
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm items-center">
        <div className="text-muted-foreground">Kind Number</div>
        <div className="flex items-center">
          <code className="font-mono">{kind}</code>
          <Button
            variant="copy"
            className="h-4 w-4"
            disabled={copied}
            onClick={copyKind}
          >
            {copied ? (
              <CopyCheck className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
          </Button>
        </div>
        <div className="text-muted-foreground">Category</div>
        <div>{category}</div>
        <div className="text-muted-foreground">Event Type</div>
        <div>{eventType}</div>
        <div className="text-muted-foreground">Storage</div>
        <div>
          {isEphemeralKind(kind)
            ? "Not stored (ephemeral)"
            : "Stored by relays"}
        </div>
        {isParameterizedReplaceableKind(kind) && (
            <>
              <div className="text-muted-foreground">Identifier</div>
              <code className="font-mono text-xs">d-tag</code>
            </>
          )}
        {kindInfo.nip && (
          <>
            <div className="text-muted-foreground">Defined in</div>
            <NIPBadge nipNumber={kindInfo.nip} />
          </>
        )}
      </div>

      {/* Schema Information */}
      {schema && (
        <>
          {/* Content Type */}
          {schema.content && (
            <div>
              <h2 className="text-lg font-semibold mb-2">Content</h2>
              <p className="text-sm text-muted-foreground">
                {getContentTypeDescription(schema.content.type)}
              </p>
            </div>
          )}

          {/* Tags */}
          {schema.tags && schema.tags.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">
                Supported Tags
                {schema.required && schema.required.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({schema.required.length} required)
                  </span>
                )}
              </h2>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-semibold w-20">name</th>
                      <th className="text-left p-3 font-semibold">value</th>
                      <th className="text-left p-3 font-semibold">
                        other parameters
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {schema.tags.map((tag, i) => {
                      const isRequired = schema.required?.includes(tag.name);
                      const structure = parseTagStructure(tag);
                      return (
                        <tr
                          key={i}
                          className="border-t border-border hover:bg-muted/30"
                        >
                          <td className="p-3 align-top">
                            <code className="font-mono text-primary">
                              {tag.name}
                            </code>
                            {isRequired && (
                              <span className="ml-2 text-[10px] bg-destructive/20 text-destructive px-1.5 py-0.5 rounded whitespace-nowrap align-middle">
                                required
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground align-top">
                            {structure.primaryValue || "—"}
                          </td>
                          <td className="p-3 text-muted-foreground align-top">
                            {structure.otherParameters.length > 0
                              ? structure.otherParameters.join(", ")
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Usage Status */}
          <div className="text-xs text-muted-foreground pt-2">
            {schema.in_use
              ? "✓ Actively used in the Nostr ecosystem"
              : "⚠ Deprecated or experimental"}
          </div>
        </>
      )}
    </CenteredContent>
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
  if (isReplaceableKind(kind)) return "Replaceable Events";
  if (isEphemeralKind(kind)) return "Ephemeral Events";
  if (isParameterizedReplaceableKind(kind)) return "Parameterized Replaceable";
  if (kind >= 40000) return "Custom/Experimental";
  return "Other";
}

/**
 * Determine the replaceability of an event kind
 */
function getEventType(kind: number): string {
  // nostr-tools' isReplaceableKind already includes kinds 0 (Metadata) and 3 (Contacts)
  if (isReplaceableKind(kind)) {
    return "Replaceable";
  }
  if (isParameterizedReplaceableKind(kind)) {
    return "Parameterized Replaceable";
  }
  if (isEphemeralKind(kind)) {
    return "Ephemeral";
  }
  return "Regular";
}
