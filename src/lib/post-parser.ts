import type { PostWindowProps } from "@/components/PostWindow";

/**
 * Parse POST command arguments
 *
 * Format: post [-k <kind>]
 *
 * Examples:
 *   post          # Create a kind 1 note
 *   post -k 30023 # Create a kind 30023 event
 *   post --kind 1 # Create a kind 1 note (explicit)
 *
 * @param args - Command arguments
 * @returns Props for PostWindow
 */
export function parsePostCommand(args: string[]): PostWindowProps {
  const props: PostWindowProps = {
    kind: 1, // Default to kind 1
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // --kind or -k flag
    if (arg === "--kind" || arg === "-k") {
      const kindStr = args[i + 1];
      if (kindStr && !kindStr.startsWith("-")) {
        const kind = parseInt(kindStr, 10);
        if (!isNaN(kind)) {
          props.kind = kind;
        }
        i++; // Skip next arg (we consumed it)
      }
      continue;
    }
  }

  return props;
}
