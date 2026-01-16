/**
 * Normalize wiki subject according to NIP-54 rules:
 * - Convert to lowercase
 * - Replace whitespace with hyphens
 * - Remove punctuation/symbols (except UTF-8 chars and hyphens)
 * - Collapse multiple hyphens
 * - Strip leading/trailing hyphens
 */
export function normalizeWikiSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/[^\w\u0080-\uFFFF-]/g, "") // remove non-word chars except UTF-8 and hyphens
    .replace(/-+/g, "-") // collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // strip leading/trailing hyphens
}

/**
 * Parse wiki command arguments
 * Usage: wiki <subject>
 * Examples:
 *   wiki bitcoin           -> { subject: "bitcoin" }
 *   wiki "Bitcoin Core"    -> { subject: "bitcoin-core" }
 *   wiki Москва            -> { subject: "москва" }
 */
export function parseWikiCommand(args: string[]): { subject: string } {
  if (args.length === 0) {
    throw new Error("Wiki subject is required. Usage: wiki <subject>");
  }

  // Join all args (in case subject was split by spaces without quotes)
  const rawSubject = args.join(" ");

  // Normalize according to NIP-54 rules
  const subject = normalizeWikiSubject(rawSubject);

  if (!subject) {
    throw new Error(
      "Invalid wiki subject. Subject cannot be empty after normalization.",
    );
  }

  return { subject };
}
