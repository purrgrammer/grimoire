/**
 * Shared locale utilities (non-React)
 * For the React hook version, see src/hooks/useLocale.ts
 */

/** Get base language code from browser (e.g., "de", "en") */
export function getBrowserLanguage(): string {
  const lang = navigator?.language || navigator?.languages?.[0] || "en";
  return lang.split("-")[0].toLowerCase();
}

/** Get the full browser locale string (e.g., "en-US", "de-DE") */
export function getBrowserLocale(): string {
  return navigator?.language || navigator?.languages?.[0] || "en-US";
}

/**
 * Format a language code as a human-friendly name using Intl.DisplayNames.
 * Falls back to the raw code if the language is not recognized.
 * Example: "de" → "German", "en" → "English"
 */
export function formatLanguageName(languageCode: string): string {
  try {
    const displayNames = new Intl.DisplayNames([getBrowserLocale()], {
      type: "language",
    });
    return displayNames.of(languageCode) ?? languageCode;
  } catch {
    return languageCode;
  }
}

/**
 * Format an ISO date string (e.g., "2024-01-15") in a locale-aware way.
 * Returns a human-readable long date like "January 15, 2024".
 */
export function formatISODate(isoDate: string): string {
  try {
    const parts = isoDate.split("-");
    if (parts.length !== 3) return isoDate;
    const [year, month, day] = parts.map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return isoDate;
    const date = new Date(year, month - 1, day); // local time, no UTC shift
    if (isNaN(date.getTime())) return isoDate;
    return date.toLocaleDateString(getBrowserLocale(), {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}
