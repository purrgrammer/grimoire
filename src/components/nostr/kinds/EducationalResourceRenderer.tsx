import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getAmbName,
  getAmbDescription,
  getAmbLanguage,
  getAmbTypes,
  getAmbKeywords,
  getAmbEducationalLevel,
  getAmbLearningResourceType,
  getAmbCreators,
  getAmbExternalUrls,
} from "@/lib/amb-helpers";
import { Label } from "@/components/ui/label";
import { UserName } from "@/components/nostr/UserName";
import { ExternalLink } from "lucide-react";
import { formatLanguageName } from "@/lib/locale-utils";

/**
 * Feed renderer for Kind 30142 - Educational Resource (AMB)
 * Compact card showing title, types, language, description, keywords, and creators
 */
export function EducationalResourceRenderer({ event }: BaseEventProps) {
  const name = getAmbName(event);
  const description = getAmbDescription(event);
  const language = getAmbLanguage(event);
  const types = getAmbTypes(event);
  const keywords = getAmbKeywords(event);
  const educationalLevel = getAmbEducationalLevel(event);
  const learningResourceType = getAmbLearningResourceType(event);
  const creators = getAmbCreators(event);
  const externalUrls = getAmbExternalUrls(event);
  const primaryUrl = externalUrls[0];
  const displayUrl = primaryUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2 min-w-0">
        {/* Title */}
        <ClickableEventTitle
          event={event}
          className="text-lg font-semibold text-foreground"
        >
          {name || "Untitled Resource"}
        </ClickableEventTitle>

        {/* Primary URL */}
        {primaryUrl && (
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-muted-foreground hover:underline hover:decoration-dotted"
          >
            <ExternalLink className="size-4 flex-shrink-0" />
            <span className="text-sm truncate">{displayUrl}</span>
          </a>
        )}

        {/* Badges row: types, language, educational level, resource type */}
        <div className="flex flex-wrap items-center gap-1.5">
          {types.map((type) => (
            <Label key={type}>{type}</Label>
          ))}
          {language && <Label>{formatLanguageName(language)}</Label>}
          {educationalLevel?.label && <Label>{educationalLevel.label}</Label>}
          {learningResourceType?.label && (
            <Label>{learningResourceType.label}</Label>
          )}
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}

        {/* Keywords */}
        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {keywords.map((kw) => (
              <Label key={kw} className="text-primary/80">
                {kw}
              </Label>
            ))}
          </div>
        )}

        {/* Creators */}
        {creators.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>by</span>
            {creators.map((creator, i) => (
              <span key={creator.pubkey || creator.name || i}>
                {i > 0 && ", "}
                {creator.pubkey ? (
                  <UserName
                    pubkey={creator.pubkey}
                    relayHints={
                      creator.relayHint ? [creator.relayHint] : undefined
                    }
                  />
                ) : (
                  <span>{creator.name || "Unknown"}</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
