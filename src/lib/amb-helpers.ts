import type { NostrEvent } from "@/types/nostr";
import { getTagValue, getOrComputeCachedValue } from "applesauce-core/helpers";
import { getBrowserLanguage } from "@/lib/locale-utils";

/**
 * AMB (Allgemeines Metadatenprofil für Bildungsressourcen) Helpers
 * Extract metadata from kind 30142 educational resource events
 *
 * Uses flattened tag convention: nested JSON-LD properties are
 * represented as colon-delimited tag names (e.g., "creator:name").
 *
 * All cached helpers use getOrComputeCachedValue to avoid
 * recomputation — no useMemo needed in components.
 */

// Cache symbols
const TypesSymbol = Symbol("ambTypes");
const KeywordsSymbol = Symbol("ambKeywords");
const CreatorsSymbol = Symbol("ambCreators");
const LearningResourceTypeSymbol = Symbol("ambLearningResourceType");
const EducationalLevelSymbol = Symbol("ambEducationalLevel");
const SubjectsSymbol = Symbol("ambSubjects");
const ExternalUrlsSymbol = Symbol("ambExternalUrls");
const RelatedResourcesSymbol = Symbol("ambRelatedResources");
const AudienceSymbol = Symbol("ambAudience");

// ============================================================================
// Simple helpers (direct tag reads)
// ============================================================================

export function getAmbName(event: NostrEvent): string | undefined {
  return getTagValue(event, "name");
}

export function getAmbImage(event: NostrEvent): string | undefined {
  return getTagValue(event, "image");
}

export function getAmbDescription(event: NostrEvent): string | undefined {
  return event.content || getTagValue(event, "description");
}

export function getAmbLanguage(event: NostrEvent): string | undefined {
  return getTagValue(event, "inLanguage");
}

export function getAmbLicenseId(event: NostrEvent): string | undefined {
  return getTagValue(event, "license:id");
}

export function getAmbIsAccessibleForFree(
  event: NostrEvent,
): boolean | undefined {
  const val = getTagValue(event, "isAccessibleForFree");
  if (val === "true") return true;
  if (val === "false") return false;
  return undefined;
}

export function getAmbDateCreated(event: NostrEvent): string | undefined {
  return getTagValue(event, "dateCreated");
}

export function getAmbDatePublished(event: NostrEvent): string | undefined {
  return getTagValue(event, "datePublished");
}

// ============================================================================
// Cached helpers (iterate tags)
// ============================================================================

/** All `type` tag values (e.g., ["LearningResource", "Course"]) */
export function getAmbTypes(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, TypesSymbol, () =>
    event.tags.filter((t) => t[0] === "type" && t[1]).map((t) => t[1]),
  );
}

/** All `t` tag values (keywords) */
export function getAmbKeywords(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, KeywordsSymbol, () =>
    event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]),
  );
}

export interface AmbCreator {
  pubkey?: string;
  relayHint?: string;
  name?: string;
  type?: string;
  affiliationName?: string;
  id?: string;
}

/**
 * Extract creators from both `p` tags with "creator" role
 * and `creator:*` flattened tags.
 */
export function getAmbCreators(event: NostrEvent): AmbCreator[] {
  return getOrComputeCachedValue(event, CreatorsSymbol, () => {
    const creators: AmbCreator[] = [];

    // Nostr-native creators from p tags with "creator" role
    for (const tag of event.tags) {
      if (tag[0] === "p" && tag[3] === "creator" && tag[1]) {
        creators.push({
          pubkey: tag[1],
          relayHint: tag[2] || undefined,
        });
      }
    }

    // External creators from flattened tags
    const creatorName = getTagValue(event, "creator:name");
    const creatorType = getTagValue(event, "creator:type");
    const creatorAffiliation = getTagValue(event, "creator:affiliation:name");
    const creatorId = getTagValue(event, "creator:id");

    if (creatorName || creatorType || creatorAffiliation || creatorId) {
      // Merge with the first p-tag creator if it exists, otherwise create new
      const existingNostr = creators.find((c) => c.pubkey);
      if (existingNostr) {
        existingNostr.name = creatorName;
        existingNostr.type = creatorType;
        existingNostr.affiliationName = creatorAffiliation;
        existingNostr.id = creatorId;
      } else {
        creators.push({
          name: creatorName,
          type: creatorType,
          affiliationName: creatorAffiliation,
          id: creatorId,
        });
      }
    }

    return creators;
  });
}

export interface AmbConceptRef {
  id?: string;
  label?: string;
}

/** learningResourceType from flattened tags */
export function getAmbLearningResourceType(
  event: NostrEvent,
): AmbConceptRef | undefined {
  return getOrComputeCachedValue(event, LearningResourceTypeSymbol, () => {
    const id = getTagValue(event, "learningResourceType:id");
    const label = findPrefLabel(event, "learningResourceType");
    if (!id && !label) return undefined;
    return { id, label };
  });
}

/** educationalLevel from flattened tags */
export function getAmbEducationalLevel(
  event: NostrEvent,
): AmbConceptRef | undefined {
  return getOrComputeCachedValue(event, EducationalLevelSymbol, () => {
    const id = getTagValue(event, "educationalLevel:id");
    const label = findPrefLabel(event, "educationalLevel");
    if (!id && !label) return undefined;
    return { id, label };
  });
}

/** audience from flattened tags */
export function getAmbAudience(event: NostrEvent): AmbConceptRef | undefined {
  return getOrComputeCachedValue(event, AudienceSymbol, () => {
    const id = getTagValue(event, "audience:id");
    const label = findPrefLabel(event, "audience");
    if (!id && !label) return undefined;
    return { id, label };
  });
}

/** All about:* subjects as concept references */
export function getAmbSubjects(event: NostrEvent): AmbConceptRef[] {
  return getOrComputeCachedValue(event, SubjectsSymbol, () => {
    const ids: string[] = [];
    // Group labels by language: Map<lang, labels[]>
    const labelsByLang = new Map<string, string[]>();

    for (const tag of event.tags) {
      if (tag[0] === "about:id" && tag[1]) {
        ids.push(tag[1]);
      }
      if (tag[0]?.startsWith("about:prefLabel:") && tag[1]) {
        const lang = tag[0].slice("about:prefLabel:".length);
        let arr = labelsByLang.get(lang);
        if (!arr) {
          arr = [];
          labelsByLang.set(lang, arr);
        }
        arr.push(tag[1]);
      }
    }

    // Pick best language set: browser lang > "en" > first available
    const browserLang = getBrowserLanguage();
    const labels =
      labelsByLang.get(browserLang) ??
      labelsByLang.get("en") ??
      labelsByLang.values().next().value ??
      [];

    // Pair ids with labels positionally
    const count = Math.max(ids.length, labels.length);
    const subjects: AmbConceptRef[] = [];
    for (let i = 0; i < count; i++) {
      subjects.push({
        id: ids[i],
        label: labels[i],
      });
    }

    return subjects;
  });
}

/** All `r` tag values (external URLs) */
export function getAmbExternalUrls(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, ExternalUrlsSymbol, () =>
    event.tags.filter((t) => t[0] === "r" && t[1]).map((t) => t[1]),
  );
}

export interface AmbRelatedResource {
  address: string;
  relayHint?: string;
  relationship?: string;
}

/** `a` tags pointing to other 30142 events with relationship type */
export function getAmbRelatedResources(
  event: NostrEvent,
): AmbRelatedResource[] {
  return getOrComputeCachedValue(event, RelatedResourcesSymbol, () =>
    event.tags
      .filter((t) => t[0] === "a" && t[1]?.startsWith("30142:"))
      .map((t) => ({
        address: t[1],
        relayHint: t[2] || undefined,
        relationship: t[3] || undefined,
      })),
  );
}

// ============================================================================
// Internal utilities
// ============================================================================

/**
 * Find the best prefLabel for a given prefix using locale fallback:
 * browser language > "en" > first available
 */
function findPrefLabel(event: NostrEvent, prefix: string): string | undefined {
  const labelPrefix = `${prefix}:prefLabel:`;
  const browserLang = getBrowserLanguage();

  let browserMatch: string | undefined;
  let enMatch: string | undefined;
  let firstMatch: string | undefined;

  for (const tag of event.tags) {
    if (tag[0]?.startsWith(labelPrefix) && tag[1]) {
      const lang = tag[0].slice(labelPrefix.length);
      if (!firstMatch) firstMatch = tag[1];
      if (lang === browserLang && !browserMatch) browserMatch = tag[1];
      if (lang === "en" && !enMatch) enMatch = tag[1];
      // Early exit if we found the best match
      if (browserMatch) break;
    }
  }

  return browserMatch ?? enMatch ?? firstMatch;
}
