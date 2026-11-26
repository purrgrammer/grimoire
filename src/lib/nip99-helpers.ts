import type { NostrEvent } from "@/types/nostr";
import { getOrComputeCachedValue } from "applesauce-core/helpers";

/**
 * NIP-99 Classified Listings
 * https://github.com/nostr-protocol/nips/blob/master/99.md
 *
 * - kind 30402: a classified listing
 * - kind 30403: "the same structure", used for draft *or inactive* listings.
 *   The spec does not say which of the two a given 30403 is, so neither does
 *   Grimoire: it is labelled "Draft or inactive", never just "Draft".
 *
 * Every value here is an untrusted tag. The parser never throws, keeps the
 * first usable value of a repeated single-value tag, and returns `undefined`
 * for anything it cannot read rather than guessing. Nothing it returns is
 * markup; callers render it as text.
 */

export const CLASSIFIED_KIND = 30402;
export const CLASSIFIED_DRAFT_KIND = 30403;

export function isClassifiedKind(kind: number): boolean {
  return kind === CLASSIFIED_KIND || kind === CLASSIFIED_DRAFT_KIND;
}

export interface ClassifiedPrice {
  /** The amount exactly as written in the tag, trimmed. */
  raw: string;
  /** The amount as a number, or `undefined` when `raw` is not numeric. */
  amount?: number;
  /** Decimal places written in `raw`, so formatting neither adds nor drops any. */
  decimals: number;
  /** The currency code as written (trimmed); may be missing on a malformed tag. */
  currency?: string;
  /** Recurrence noun ("month", "hour"), when the listing has one. */
  frequency?: string;
}

/**
 * The spec allows only "active" and "sold" (SHOULD). Anything else is kept
 * verbatim as `other` and shown as the author wrote it.
 */
export type ClassifiedStatus =
  { type: "active" } | { type: "sold" } | { type: "other"; value: string };

export interface ClassifiedImage {
  url: string;
  /** NIP-58 dimensions ("256x256"), only when well formed. */
  width?: number;
  height?: number;
}

export interface Classified {
  /** True for kind 30403 (draft or inactive). */
  isDraft: boolean;
  identifier: string;
  title?: string;
  summary?: string;
  /** Unix seconds of first publication, per the `published_at` tag. */
  publishedAt?: number;
  location?: string;
  geohash?: string;
  price?: ClassifiedPrice;
  status?: ClassifiedStatus;
  /** `t` tags, de-duplicated case-insensitively, first spelling kept. */
  categories: string[];
  /** `image` tags with http(s) URLs only, de-duplicated, in tag order. */
  images: ClassifiedImage[];
}

/** Longest single-value tag we keep; a listing title is not a novel. */
const MAX_TEXT = 500;

function firstText(event: NostrEvent, name: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== name || typeof tag[1] !== "string") continue;
    const value = tag[1].trim();
    if (value) return value.slice(0, MAX_TEXT);
  }
  return undefined;
}

/** Accept only absolute http(s) URLs; `javascript:`, `data:` and relative paths are dropped. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

const AMOUNT = /^\d+(?:\.(\d+))?$/;

export function parsePriceTag(tag: string[]): ClassifiedPrice | undefined {
  const raw = typeof tag[1] === "string" ? tag[1].trim() : "";
  if (!raw) return undefined;
  const match = AMOUNT.exec(raw);
  const amount = match ? Number(raw) : undefined;
  const currency =
    typeof tag[2] === "string" && tag[2].trim()
      ? tag[2].trim().slice(0, 16)
      : undefined;
  const frequency =
    typeof tag[3] === "string" && tag[3].trim()
      ? tag[3].trim().slice(0, 32)
      : undefined;
  return {
    raw: raw.slice(0, 64),
    amount:
      amount !== undefined && Number.isFinite(amount) ? amount : undefined,
    decimals: match?.[1]?.length ?? 0,
    currency,
    frequency,
  };
}

/**
 * The first price tag with a numeric amount wins; failing that, the first
 * price tag with any amount, so a malformed price is shown as written
 * instead of vanishing.
 */
function getPrice(event: NostrEvent): ClassifiedPrice | undefined {
  let fallback: ClassifiedPrice | undefined;
  for (const tag of event.tags) {
    if (tag[0] !== "price") continue;
    const price = parsePriceTag(tag);
    if (!price) continue;
    if (price.amount !== undefined) return price;
    fallback ??= price;
  }
  return fallback;
}

function getStatus(event: NostrEvent): ClassifiedStatus | undefined {
  const value = firstText(event, "status");
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "active") return { type: "active" };
  if (normalized === "sold") return { type: "sold" };
  return { type: "other", value: value.slice(0, 32) };
}

function getPublishedAt(event: NostrEvent): number | undefined {
  const value = firstText(event, "published_at");
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  // Zero and absurd values (past year ~2286, or a milliseconds slip) are not dates.
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 9_999_999_999)
    return undefined;
  return seconds;
}

function getCategories(event: NostrEvent): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "t" || typeof tag[1] !== "string") continue;
    const value = tag[1].trim().slice(0, 64);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const DIMENSIONS = /^(\d{1,5})x(\d{1,5})$/;

function getImages(event: NostrEvent): ClassifiedImage[] {
  const seen = new Set<string>();
  const out: ClassifiedImage[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "image") continue;
    const url = safeHttpUrl(tag[1]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const dims =
      typeof tag[2] === "string" ? DIMENSIONS.exec(tag[2].trim()) : null;
    const width = dims ? Number(dims[1]) : 0;
    const height = dims ? Number(dims[2]) : 0;
    out.push(width > 0 && height > 0 ? { url, width, height } : { url });
  }
  return out;
}

const ClassifiedSymbol = Symbol("nip99-classified");

/** Parse a kind 30402/30403 event. Cached on the event object. */
export function parseClassified(event: NostrEvent): Classified {
  return getOrComputeCachedValue(event, ClassifiedSymbol, () => ({
    isDraft: event.kind === CLASSIFIED_DRAFT_KIND,
    identifier:
      event.tags.find((t) => t[0] === "d" && typeof t[1] === "string")?.[1] ??
      "",
    title: firstText(event, "title"),
    summary: firstText(event, "summary"),
    publishedAt: getPublishedAt(event),
    location: firstText(event, "location"),
    geohash: firstText(event, "g")?.slice(0, 12),
    price: getPrice(event),
    status: getStatus(event),
    categories: getCategories(event),
    images: getImages(event),
  }));
}

const SATS = new Set(["sat", "sats", "satoshi", "satoshis"]);

/**
 * Format a price in the reader's locale, using only what the tag says.
 *
 * - No exchange rates, ever: a price is shown in the currency it was listed in.
 * - The listing's own precision is kept: "50" stays `$50`, "0.0005 BTC" keeps
 *   four decimals (a fixed two would round it to nothing).
 * - A 3-letter code goes through `Intl` currency formatting; sats and longer
 *   codes ("USDT") get a grouped number followed by the code as written.
 * - A non-numeric amount is returned as written, followed by the code.
 */
export function formatClassifiedPrice(
  price: ClassifiedPrice,
  locale: string,
): string {
  const currency = price.currency;
  if (price.amount === undefined) {
    return currency ? `${price.raw} ${currency}` : price.raw;
  }
  const digits = Math.min(price.decimals, 8);
  const number = (opts: Intl.NumberFormatOptions = {}) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      ...opts,
    }).format(price.amount!);

  if (!currency) return number();
  if (SATS.has(currency.toLowerCase())) return `${number()} sats`;
  if (/^[a-z]{3}$/i.test(currency)) {
    try {
      return number({ style: "currency", currency: currency.toUpperCase() });
    } catch {
      // fall through to the plain form
    }
  }
  return `${number()} ${currency}`;
}

/** "per month" — the frequency noun as the listing wrote it. */
export function formatFrequency(frequency: string): string {
  return `per ${frequency}`;
}

/** Price plus frequency, e.g. "€15 / month", for one-line contexts. */
export function formatClassifiedPriceShort(
  price: ClassifiedPrice,
  locale: string,
): string {
  const base = formatClassifiedPrice(price, locale);
  return price.frequency ? `${base} / ${price.frequency}` : base;
}
