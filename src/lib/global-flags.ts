/**
 * Global command flags system
 *
 * Extracts global flags (like --title) from tokenized command arguments.
 * Global flags work across ALL commands and are processed before command-specific parsing.
 */

export interface GlobalFlags {
  windowProps?: {
    title?: string;
  };
  // Future: layoutHints, dispatchOpts, etc.
}

export interface ExtractResult {
  globalFlags: GlobalFlags;
  remainingTokens: string[];
}

const RESERVED_GLOBAL_FLAGS = ['--title'] as const;

/**
 * Sanitize a title string: strip control characters, limit length
 */
function sanitizeTitle(title: string): string | undefined {
  const sanitized = title
    .replace(/[\x00-\x1F\x7F]/g, '') // Strip control chars (newlines, tabs, null bytes)
    .trim();

  if (!sanitized) {
    return undefined; // Empty title → fallback to default
  }

  return sanitized.slice(0, 200); // Limit to 200 chars
}

/**
 * Extract global flags from tokenized arguments
 *
 * @param tokens - Array of tokenized arguments (from shell-quote or similar)
 * @returns Global flags and remaining tokens for command-specific parsing
 *
 * @example
 * extractGlobalFlagsFromTokens(['--title', 'My Window', 'profile', 'alice'])
 * // Returns: {
 * //   globalFlags: { windowProps: { title: 'My Window' } },
 * //   remainingTokens: ['profile', 'alice']
 * // }
 */
export function extractGlobalFlagsFromTokens(tokens: string[]): ExtractResult {
  const globalFlags: GlobalFlags = {};
  const remainingTokens: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token === '--title') {
      // Extract title value (next token)
      const nextToken = tokens[i + 1];

      if (nextToken === undefined || nextToken.startsWith('--')) {
        throw new Error('Flag --title requires a value. Usage: --title "Window Title"');
      }

      const sanitized = sanitizeTitle(nextToken);
      if (sanitized) {
        if (!globalFlags.windowProps) {
          globalFlags.windowProps = {};
        }
        globalFlags.windowProps.title = sanitized;
      }

      i += 2; // Skip both --title and its value
    } else {
      // Not a global flag, keep it
      remainingTokens.push(token);
      i += 1;
    }
  }

  return { globalFlags, remainingTokens };
}

/**
 * Check if a token is a known global flag
 */
export function isGlobalFlag(token: string): boolean {
  return RESERVED_GLOBAL_FLAGS.includes(token as any);
}
