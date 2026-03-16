import { useMemo } from "react";
import { NostrEvent } from "@/types/nostr";
import { useAddWindow } from "@/core/state";
import {
  getAmbName,
  getAmbDescription,
  getAmbImage,
  getAmbLanguage,
  getAmbTypes,
  getAmbKeywords,
  getAmbCreators,
  getAmbLearningResourceType,
  getAmbEducationalLevel,
  getAmbAudience,
  getAmbSubjects,
  getAmbLicenseId,
  getAmbIsAccessibleForFree,
  getAmbExternalUrls,
  getAmbRelatedResources,
  getAmbDateCreated,
  getAmbDatePublished,
} from "@/lib/amb-helpers";
import { Label } from "@/components/ui/label";
import { UserName } from "@/components/nostr/UserName";
import { MediaEmbed } from "../MediaEmbed";
import { ExternalLink } from "@/components/ExternalLink";
import { formatLanguageName, formatISODate } from "@/lib/locale-utils";

interface EducationalResourceDetailRendererProps {
  event: NostrEvent;
}

/**
 * Detail renderer for Kind 30142 - Educational Resource (AMB)
 * Full metadata view with all AMB properties
 */
export function EducationalResourceDetailRenderer({
  event,
}: EducationalResourceDetailRendererProps) {
  const addWindow = useAddWindow();

  const name = getAmbName(event);
  const description = getAmbDescription(event);
  const image = getAmbImage(event);
  const language = getAmbLanguage(event);
  const types = getAmbTypes(event);
  const keywords = getAmbKeywords(event);
  const creators = getAmbCreators(event);
  const learningResourceType = getAmbLearningResourceType(event);
  const educationalLevel = getAmbEducationalLevel(event);
  const audience = getAmbAudience(event);
  const subjects = getAmbSubjects(event);
  const licenseId = getAmbLicenseId(event);
  const isAccessibleForFree = getAmbIsAccessibleForFree(event);
  const externalUrls = getAmbExternalUrls(event);
  const relatedResources = getAmbRelatedResources(event);
  const dateCreated = getAmbDateCreated(event);
  const datePublished = getAmbDatePublished(event);

  const licenseLabel = useMemo(() => {
    if (!licenseId) return undefined;
    // Extract short CC label from URI
    const ccMatch = licenseId.match(
      /creativecommons\.org\/licenses?\/([\w-]+)/,
    );
    if (ccMatch) return `CC ${ccMatch[1].toUpperCase()}`;
    return licenseId;
  }, [licenseId]);

  const handleRelatedClick = (address: string) => {
    try {
      const [kindStr, pubkey, ...identifierParts] = address.split(":");
      const pointer = {
        kind: parseInt(kindStr),
        pubkey,
        identifier: identifierParts.join(":"),
      };
      addWindow("open", { pointer });
    } catch {
      // ignore malformed address
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{name || "Untitled Resource"}</h1>
        {types.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {types.map((type) => (
              <Label key={type} size="md">
                {type}
              </Label>
            ))}
          </div>
        )}
        {externalUrls[0] && (
          <ExternalLink href={externalUrls[0]} size="sm">
            {formatReferenceLabel(externalUrls[0])}
          </ExternalLink>
        )}
      </div>

      {/* Image */}
      {image && <MediaEmbed url={image} preset="preview" enableZoom />}

      {/* Description */}
      {description && <p className="text-sm">{description}</p>}

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-3 py-2 text-sm">
        {language && (
          <MetadataField label="Language">
            {formatLanguageName(language)}
          </MetadataField>
        )}

        {educationalLevel && (
          <MetadataField label="Educational Level">
            {educationalLevel.label || educationalLevel.id}
          </MetadataField>
        )}

        {learningResourceType && (
          <MetadataField label="Resource Type">
            {learningResourceType.label || learningResourceType.id}
          </MetadataField>
        )}

        {audience && (
          <MetadataField label="Audience">
            {audience.label || audience.id}
          </MetadataField>
        )}

        {licenseId && (
          <MetadataField label="License">
            {licenseId.startsWith("http") ? (
              <ExternalLink href={licenseId} variant="default" size="sm">
                {licenseLabel}
              </ExternalLink>
            ) : (
              <span>{licenseLabel}</span>
            )}
          </MetadataField>
        )}

        {isAccessibleForFree !== undefined && (
          <MetadataField label="Free Access">
            {isAccessibleForFree ? "Yes" : "No"}
          </MetadataField>
        )}

        {dateCreated && (
          <MetadataField label="Created">
            {formatISODate(dateCreated)}
          </MetadataField>
        )}

        {datePublished && (
          <MetadataField label="Published">
            {formatISODate(datePublished)}
          </MetadataField>
        )}
      </div>

      {/* Creators */}
      {creators.length > 0 && (
        <Section title="Creators">
          <div className="flex flex-col gap-2">
            {creators.map((creator, i) => (
              <div
                key={creator.pubkey || creator.name || i}
                className="text-sm"
              >
                <div className="flex items-center gap-2">
                  {creator.pubkey ? (
                    <UserName
                      pubkey={creator.pubkey}
                      relayHints={
                        creator.relayHint ? [creator.relayHint] : undefined
                      }
                    />
                  ) : (
                    <span className="font-medium">
                      {creator.name || "Unknown"}
                    </span>
                  )}
                  {creator.type && (
                    <span className="text-muted-foreground">
                      ({creator.type})
                    </span>
                  )}
                </div>
                {creator.affiliationName && (
                  <span className="text-xs text-muted-foreground ml-1">
                    {creator.affiliationName}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Subjects */}
      {subjects.length > 0 && (
        <Section title="Subjects">
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((subject, i) => (
              <Label key={subject.id || i} size="md">
                {subject.label || subject.id}
              </Label>
            ))}
          </div>
        </Section>
      )}

      {/* Keywords */}
      {keywords.length > 0 && (
        <Section title="Keywords">
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <Label key={kw}>{kw}</Label>
            ))}
          </div>
        </Section>
      )}

      {/* External References */}
      {externalUrls.length > 0 && (
        <Section title="References">
          <div className="flex flex-col gap-1">
            {externalUrls.map((url) => (
              <ExternalLink key={url} href={url} variant="default" size="sm">
                {formatReferenceLabel(url)}
              </ExternalLink>
            ))}
          </div>
        </Section>
      )}

      {/* Related Resources */}
      {relatedResources.length > 0 && (
        <Section title="Related Resources">
          <div className="flex flex-col gap-1">
            {relatedResources.map((res, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => handleRelatedClick(res.address)}
                  className="text-primary hover:underline cursor-crosshair truncate"
                >
                  {res.address.split(":").slice(2).join(":") || res.address}
                </button>
                {res.relationship && <Label>{res.relationship}</Label>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function MetadataField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-muted-foreground">{label}</h3>
      <span>{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

/** Format a reference URL for display (detect DOI, ISBN) */
function formatReferenceLabel(url: string): string {
  if (url.includes("doi.org/")) {
    const doi = url.split("doi.org/")[1];
    return `DOI: ${doi}`;
  }
  if (url.startsWith("urn:isbn:")) {
    return `ISBN: ${url.replace("urn:isbn:", "")}`;
  }
  return url;
}
