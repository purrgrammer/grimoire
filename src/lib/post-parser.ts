import type { PostWindowProps } from "@/components/PostWindow";

/**
 * Parse POST command arguments
 *
 * Format: post [--thread] [--reply <event-id>]
 *
 * Examples:
 *   post                    # Create a kind 1 note
 *   post --thread           # Create a kind 11 thread
 *   post --reply <id>       # Reply to a specific event
 *   post -r note1...        # Reply using short flag
 *
 * @param args - Command arguments
 * @returns Props for PostWindow
 */
export function parsePostCommand(args: string[]): PostWindowProps {
  const props: PostWindowProps = {
    type: "note",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // --thread flag
    if (arg === "--thread" || arg === "-t") {
      props.type = "thread";
      continue;
    }

    // --reply flag with event ID
    if (arg === "--reply" || arg === "-r") {
      const replyTo = args[i + 1];
      if (replyTo && !replyTo.startsWith("-")) {
        props.replyTo = replyTo;
        i++; // Skip next arg (we consumed it)
      }
      continue;
    }
  }

  return props;
}
