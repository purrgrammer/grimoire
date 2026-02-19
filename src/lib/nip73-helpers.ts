/**
 * NIP-73 External Content IDs
 * Utility functions for parsing and displaying NIP-73 external identifiers
 *
 * External identifiers (i-tags) reference content outside Nostr:
 * URLs, books (ISBN), podcasts, movies (ISAN), papers (DOI), geohashes,
 * countries (ISO-3166), hashtags, and blockchain transactions/addresses.
 *
 * Used by:
 * - NIP-22 comments (kind 1111) referencing external content
 * - NIP-85 trusted assertions (kind 30385) rating external content
 */

import type { LucideIcon } from "lucide-react";
import {
  Globe,
  Podcast,
  BookOpen,
  FileText,
  MapPin,
  Hash,
  Coins,
  Film,
  Flag,
  ExternalLink,
} from "lucide-react";

/**
 * Map a NIP-73 external identifier type (K/k value) to an appropriate icon.
 */
export function getExternalIdentifierIcon(kValue: string): LucideIcon {
  if (kValue === "web") return Globe;
  if (kValue.startsWith("podcast")) return Podcast;
  if (kValue === "isbn") return BookOpen;
  if (kValue === "doi") return FileText;
  if (kValue === "geo") return MapPin;
  if (kValue === "iso3166") return Flag;
  if (kValue === "#") return Hash;
  if (kValue === "isan") return Film;
  // Blockchain types: "bitcoin:tx", "ethereum:1:address", etc.
  if (kValue.includes(":tx") || kValue.includes(":address")) return Coins;
  return ExternalLink;
}

/**
 * Get a human-friendly label for an external identifier value.
 */
export function getExternalIdentifierLabel(
  iValue: string,
  kValue?: string,
): string {
  // URLs - show truncated
  if (
    kValue === "web" ||
    iValue.startsWith("http://") ||
    iValue.startsWith("https://")
  ) {
    try {
      const url = new URL(iValue);
      const path = url.pathname === "/" ? "" : url.pathname;
      return `${url.hostname}${path}`;
    } catch {
      return iValue;
    }
  }

  // Podcast types
  if (iValue.startsWith("podcast:item:guid:")) return "Podcast Episode";
  if (iValue.startsWith("podcast:publisher:guid:")) return "Podcast Publisher";
  if (iValue.startsWith("podcast:guid:")) return "Podcast Feed";

  // ISBN
  if (iValue.startsWith("isbn:")) return `ISBN ${iValue.slice(5)}`;

  // DOI
  if (iValue.startsWith("doi:")) return `DOI ${iValue.slice(4)}`;

  // Geohash
  if (kValue === "geo") return `Location ${iValue}`;

  // Country codes
  if (kValue === "iso3166") return iValue.toUpperCase();

  // Hashtag
  if (iValue.startsWith("#")) return iValue;

  // Blockchain
  if (iValue.includes(":tx:"))
    return `Transaction ${iValue.split(":tx:")[1]?.slice(0, 12)}...`;
  if (iValue.includes(":address:"))
    return `Address ${iValue.split(":address:")[1]?.slice(0, 12)}...`;

  return iValue;
}

/**
 * Infer a NIP-73 k-tag value from an i-tag value when no k-tag is present.
 * Useful for contexts where only the identifier is available.
 */
export function inferExternalIdentifierType(iValue: string): string {
  if (iValue.startsWith("http://") || iValue.startsWith("https://"))
    return "web";
  if (iValue.startsWith("podcast:")) {
    if (iValue.startsWith("podcast:item:guid:")) return "podcast:item:guid";
    if (iValue.startsWith("podcast:publisher:guid:"))
      return "podcast:publisher:guid";
    return "podcast:guid";
  }
  if (iValue.startsWith("isbn:")) return "isbn";
  if (iValue.startsWith("doi:")) return "doi";
  if (iValue.startsWith("geo:")) return "geo";
  if (iValue.startsWith("iso3166:")) return "iso3166";
  if (iValue.startsWith("#")) return "#";
  if (iValue.startsWith("isan:")) return "isan";
  if (iValue.includes(":tx:")) {
    const chain = iValue.split(":")[0];
    return `${chain}:tx`;
  }
  if (iValue.includes(":address:")) {
    const chain = iValue.split(":")[0];
    return `${chain}:address`;
  }
  return "web";
}

/**
 * Resolve the best href for an external identifier.
 * Uses the hint if available, otherwise the raw value if it's a URL.
 */
export function getExternalIdentifierHref(
  iValue: string,
  hint?: string,
): string | undefined {
  if (hint) return hint;
  if (iValue.startsWith("http://") || iValue.startsWith("https://"))
    return iValue;
  return undefined;
}

/**
 * Get a human-friendly type label for a NIP-73 k-tag value.
 * Maps protocol-level k-values to user-facing names.
 */
export function getExternalTypeLabel(kValue: string): string {
  if (kValue === "web") return "Website";
  if (kValue === "podcast:item:guid") return "Podcast Episode";
  if (kValue === "podcast:publisher:guid") return "Podcast Publisher";
  if (kValue === "podcast:guid" || kValue.startsWith("podcast"))
    return "Podcast";
  if (kValue === "isbn") return "Book";
  if (kValue === "doi") return "Paper";
  if (kValue === "geo") return "Location";
  if (kValue === "iso3166") return "Country";
  if (kValue === "#") return "Hashtag";
  if (kValue === "isan") return "Film";
  if (kValue.includes(":tx")) return "Transaction";
  if (kValue.includes(":address")) return "Address";
  return kValue;
}
