import { useMemo } from "react";

export interface LocaleConfig {
  /** Browser's detected locale (e.g., 'en-US', 'pt-BR', 'ja-JP') */
  locale: string;
  /** Language code (e.g., 'en', 'pt', 'ja') */
  language: string;
  /** Region code (e.g., 'US', 'BR', 'JP') */
  region?: string;
  /** Timezone (e.g., 'America/New_York') */
  timezone: string;
  /** 12h or 24h time preference */
  timeFormat: "12h" | "24h";
}

/**
 * Hook to get user's locale preferences from browser
 * Falls back to en-US if detection fails
 */
export function useLocale(): LocaleConfig {
  return useMemo(() => {
    // Get browser locale
    const browserLocale =
      navigator.language || navigator.languages?.[0] || "en-US";

    // Parse locale into language and region
    const [language, region] = browserLocale.split("-");

    // Detect timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Detect 12h vs 24h preference by formatting a test date
    const testDate = new Date(2000, 0, 1, 13, 0); // 1PM
    const formatted = testDate.toLocaleTimeString(browserLocale, {
      hour: "numeric",
    });
    const timeFormat =
      formatted.includes("PM") || formatted.includes("AM") ? "12h" : "24h";

    return {
      locale: browserLocale,
      language,
      region,
      timezone,
      timeFormat,
    };
  }, []);
}

/**
 * Format a timestamp according to locale preferences
 * @param timestamp - Unix timestamp in seconds
 * @param style - 'relative' for "2h ago", 'absolute' for full date/time, 'date' for date only,
 *                'long' for full readable date (e.g., "January 15, 2025"), 'time' for time only,
 *                'datetime' for date with time (e.g., "January 15, 2025, 2:30 PM")
 * @param locale - Optional locale override (defaults to browser locale)
 */
export function formatTimestamp(
  timestamp: number,
  style:
    | "relative"
    | "absolute"
    | "date"
    | "long"
    | "time"
    | "datetime" = "relative",
  locale?: string,
): string {
  const browserLocale = locale || navigator.language || "en-US";
  const date = new Date(timestamp * 1000);

  if (style === "relative") {
    const now = Date.now();
    const diff = now - timestamp * 1000;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    return `${years}y ago`;
  }

  if (style === "absolute") {
    // ISO-8601 style: 2025-12-10 23:42
    return date
      .toLocaleString(browserLocale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(",", "");
  }

  if (style === "date") {
    return date.toLocaleDateString(browserLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  if (style === "long") {
    // Human-readable long format: "January 15, 2025"
    return date.toLocaleDateString(browserLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  if (style === "datetime") {
    // Full date with time: "January 15, 2025, 2:30 PM"
    return date.toLocaleString(browserLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (style === "time") {
    return date.toLocaleTimeString(browserLocale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return date.toLocaleString(browserLocale);
}
