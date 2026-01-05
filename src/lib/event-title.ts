import { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import { getArticleTitle } from "applesauce-core/helpers/article";
import {
  getRepositoryName,
  getIssueTitle,
  getPatchSubject,
  getPullRequestSubject,
} from "@/lib/nip34-helpers";
import { getCodeName } from "@/lib/nip-c0-helpers";
import { getAppName } from "@/lib/nip89-helpers";
import { getKindInfo } from "@/constants/kinds";

/**
 * Get a human-readable display title for any event
 *
 * Priority order:
 * 1. Kind-specific helper functions (most accurate)
 * 2. Generic 'subject' or 'title' tags
 * 3. Event kind name as fallback
 *
 * @param event - The Nostr event
 * @returns Human-readable title string
 */
export function getEventDisplayTitle(
  event: NostrEvent,
  showKind = true,
): string {
  // Try kind-specific helpers first (most accurate)
  let title: string | undefined;

  switch (event.kind) {
    case kinds.LongFormArticle: // Long-form article
      title = getArticleTitle(event);
      break;
    case 30617: // Repository
      title = getRepositoryName(event);
      break;
    case 1337: // Code snippet
      title = getCodeName(event);
      break;
    case 1621: // Issue
      title = getIssueTitle(event);
      break;
    case 1617: // Patch
      title = getPatchSubject(event);
      break;
    case 1618: // Pull request
      title = getPullRequestSubject(event);
      break;
    case 31990: // Application Handler
      title = getAppName(event);
      break;
  }

  if (title) return title;

  // Try generic tag extraction
  title =
    getTagValue(event, "subject") ||
    getTagValue(event, "title") ||
    getTagValue(event, "name");
  if (title) return title;

  // Fall back to kind name
  const kindInfo = getKindInfo(event.kind);
  if (showKind && kindInfo) {
    return kindInfo.name;
  }

  // Ultimate fallback
  if (showKind) {
    return `Kind ${event.kind}`;
  }

  return event.content;
}

/**
 * Get a window title for an event with optional prefix
 *
 * @param event - The Nostr event
 * @param prefix - Optional prefix for the title (e.g., "Repository:", "Article:")
 * @returns Formatted window title
 */
export function getEventWindowTitle(
  event: NostrEvent,
  prefix?: string,
): string {
  const title = getEventDisplayTitle(event);
  return prefix ? `${prefix} ${title}` : title;
}
