import type { NostrEvent } from "nostr-tools";
import type { LucideIcon } from "lucide-react";
import { Rocket, VenetianMask, Wallet, Zap } from "lucide-react";

/**
 * NIP-A3 — payto: Payment Targets (kind 10133).
 *
 * Tags are `["payto", "<type>", "<address>"]`. Everything a client needs to
 * render one lives in the static PAYMENT_TYPES registry below: nothing derived
 * from tag data ever reaches a URI scheme position, which is what makes
 * linking to a network's own scheme safe.
 */

export interface PaytoTarget {
  type: string;
  address: string;
}

export interface PaymentType {
  /** Human label, e.g. "Monero". */
  label: string;
  /** Unicode currency glyph, when one exists and renders as text. */
  symbol?: string;
  /** Icon for networks with no usable glyph. */
  icon?: LucideIcon;
  /** Colour for the glyph or icon, where the network has a familiar one. */
  markClassName?: string;
  /** URI scheme, e.g. "monero" → `monero:<address>`. */
  scheme?: string;
  /** Web handle services that have a profile URL instead of a scheme. */
  url?: (address: string) => string;
  /** Strip decoration the tag carries before the value goes into a URI. */
  normalize?: (address: string) => string;
  /** How the address is shown and copied, which is not always what is sent. */
  display?: (address: string) => string;
}

/** BITCOIN SIGN, the BIP-353 display prefix. */
const BITCOIN_SIGN = "\u20BF";

/**
 * A symbol is only used where the codepoint is likely to be in a system font
 * and reads as a currency mark. Where it is not — lightning (U+26A1 is
 * emoji-presentation), silent payments and PayPal (no codepoint at all) — an
 * icon is used instead. The type label is always rendered alongside, so the
 * ambiguous glyphs (◎, ɱ, Ð/Đ) never carry identity on their own.
 */
export const PAYMENT_TYPES: Record<string, PaymentType> = {
  bitcoin: { label: "Bitcoin", symbol: "₿", scheme: "bitcoin" },
  // BIP-353's identifier is `user@domain`; the ₿ is display-only — "the ₿ is
  // not included in the DNS label which is resolved" — but publishers put it in
  // the tag, so it is stripped before the value goes into a `bitcoin:` URI and
  // added back for display, which is the form the BIP says to share.
  //
  // Resolving the name to its real payment instructions means a DNS TXT lookup
  // at `user.user._bitcoin-payment.domain`, which this client does not do; the
  // URI hands the name to a wallet that can.
  bip353: {
    label: "DNS Address",
    symbol: BITCOIN_SIGN,
    scheme: "bitcoin",
    normalize: (address) => address.replace(/^\u20BF\s*/, ""),
    display: (address) =>
      address.startsWith(BITCOIN_SIGN) ? address : `${BITCOIN_SIGN}${address}`,
  },
  // A silent payment address (sp1…) is a BIP-321 payload.
  bip352: { label: "Silent Payments", icon: VenetianMask, scheme: "bitcoin" },
  // A lightning address is user@domain; the lightning: URI expects an invoice
  // or LNURL, so a handoff would fail. Zapping handles it instead.
  lightning: {
    label: "Lightning",
    icon: Zap,
    // Matches the zap button on the profile.
    markClassName: "text-yellow-500",
  },
  ethereum: { label: "Ethereum", symbol: "Ξ", scheme: "ethereum" },
  litecoin: { label: "Litecoin", symbol: "Ł", scheme: "litecoin" },
  monero: { label: "Monero", symbol: "ɱ", scheme: "monero" },
  nano: { label: "Nano", symbol: "Ӿ", scheme: "nano" },
  zcash: { label: "Zcash", symbol: "ⓩ", scheme: "zcash" },
  solana: { label: "Solana", symbol: "◎", scheme: "solana" },
  dogecoin: { label: "Dogecoin", symbol: "Ð", scheme: "dogecoin" },
  dash: { label: "Dash", symbol: "Đ", scheme: "dash" },
  tether: { label: "Tether", symbol: "₮" },
  cardano: { label: "Cardano", symbol: "₳", scheme: "web+cardano" },
  cashme: {
    label: "Cash App",
    symbol: "$",
    url: (address) => `https://cash.app/$${encodeURIComponent(address)}`,
  },
  revolut: {
    label: "Revolut",
    symbol: "$",
    url: (address) => `https://revolut.me/${encodeURIComponent(address)}`,
  },
  venmo: {
    label: "Venmo",
    symbol: "$",
    url: (address) => `https://venmo.com/u/${encodeURIComponent(address)}`,
  },
  // Not a NIP-A3 type: the profile's own lud06, shown beside the payto tags
  // so a profile has one payments list rather than three.
  lnurl: {
    label: "LNURL",
    icon: Zap,
    markClassName: "text-yellow-500",
  },
  geyser: {
    label: "Geyser",
    icon: Rocket,
    url: (address) =>
      `https://geyser.fund/project/${encodeURIComponent(address)}`,
  },
  paypal: {
    label: "PayPal",
    symbol: "$",
    url: (address) => `https://paypal.me/${encodeURIComponent(address)}`,
  },
};

/** Fallback for a type not in the registry — it still has to render. */
export const UNKNOWN_PAYMENT_ICON: LucideIcon = Wallet;

export function getPaymentType(type: string): PaymentType | undefined {
  return PAYMENT_TYPES[type];
}

/** Display label for a payment type; unknown types show their raw type. */
export function getPaymentLabel(type: string): string {
  return PAYMENT_TYPES[type]?.label ?? type;
}

/**
 * The address with whatever decoration its spec asks for — the form to copy
 * and to show where nothing else already carries it.
 */
export function getPaymentDisplayAddress(target: PaytoTarget): string {
  const entry = PAYMENT_TYPES[target.type];
  return entry?.display ? entry.display(target.address) : target.address;
}

/**
 * The address stripped of that decoration, for a row whose mark already shows
 * it — a BIP-353 name beside a ₿ glyph should not read `₿ ₿alice@example.com`.
 */
export function getPaymentBareAddress(target: PaytoTarget): string {
  const entry = PAYMENT_TYPES[target.type];
  return entry?.normalize ? entry.normalize(target.address) : target.address;
}

/**
 * Read the `payto` tags off a kind 10133 event.
 *
 * The type is lowercased and trimmed defensively — the spec says it is always
 * lowercase, but tags are untrusted input.
 */
export function getPaytoTargets(event: NostrEvent): PaytoTarget[] {
  const targets: PaytoTarget[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== "payto") continue;

    const type = tag[1]?.trim().toLowerCase();
    const address = tag[2]?.trim();
    if (!type || !address) continue;

    targets.push({ type, address });
  }

  return targets;
}

/**
 * Percent-encode anything that could break an address out of the URI it is
 * embedded in — `?`, `#`, `/`, whitespace and the like.
 *
 * `@`, `.`, `_`, `~`, `-` and `+` are left alone: they are legal in a scheme's
 * opaque part, and encoding them would mangle the address forms that use them.
 * A BIP-353 target is `alice@example.com`, and `bitcoin:alice%40example.com`
 * is not something every wallet decodes back to a human-readable name.
 */
function encodeAddress(address: string): string {
  return address.replace(/[^A-Za-z0-9@._~+-]/g, (char) =>
    encodeURIComponent(char),
  );
}

/**
 * Build a wallet URI for a target, or undefined when there is none.
 *
 * The scheme is always a literal from PAYMENT_TYPES, never the tag's type
 * string, so a `payto` tag claiming type "javascript" produces no href at all
 * rather than a `javascript:` one.
 */
export function buildPaymentUri(target: PaytoTarget): string | undefined {
  const entry = PAYMENT_TYPES[target.type];
  if (!entry) return undefined;

  const address = entry.normalize
    ? entry.normalize(target.address)
    : target.address;

  if (entry.scheme) return `${entry.scheme}:${encodeAddress(address)}`;
  if (entry.url) return entry.url(address);

  return undefined;
}

/**
 * Whether this target is a page to open rather than a payment to hand a wallet.
 * Those get a plain link — a QR of a profile URL helps nobody.
 */
export function isWebPaymentTarget(target: PaytoTarget): boolean {
  return Boolean(PAYMENT_TYPES[target.type]?.url);
}

/**
 * One payments list for a profile: the kind 0's `lud16`/`lud06` folded in
 * beside the kind 10133 targets, with a lightning address that appears in both
 * places shown once.
 */
export function mergeProfilePayments(
  targets: PaytoTarget[],
  profile: { lud16?: string; lud06?: string } | undefined,
): PaytoTarget[] {
  const lud16 = profile?.lud16?.trim();
  const lud06 = profile?.lud06?.trim();

  const has = (address: string) =>
    targets.some(
      (target) => target.address.toLowerCase() === address.toLowerCase(),
    );

  return [
    ...(lud16 && !has(lud16) ? [{ type: "lightning", address: lud16 }] : []),
    ...targets,
    ...(lud06 && !has(lud06) ? [{ type: "lnurl", address: lud06 }] : []),
  ];
}
