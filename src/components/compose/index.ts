/**
 * Compose/Reply Dialog System
 *
 * A generic, protocol-aware compose dialog for Nostr events.
 *
 * ## Features
 *
 * - **Rich Text Editing**: TipTap-based editor with @ mentions and : emoji autocomplete
 * - **Threading**: Automatic NIP-10 (kind 1) and NIP-22 (all others) threading
 * - **Relay Selection**: Choose which relays to publish to with connection status
 * - **Mention Management**: Explicit p-tag control with profile search
 * - **Preview Mode**: Preview content and tags before publishing
 * - **Power Tools**: Quick access to hashtags, mentions, code blocks, links
 *
 * ## Usage
 *
 * ```tsx
 * import { ComposeDialog } from "@/components/compose";
 *
 * function MyComponent() {
 *   const [showCompose, setShowCompose] = useState(false);
 *   const [replyTo, setReplyTo] = useState<NostrEvent | undefined>();
 *
 *   return (
 *     <>
 *       <Button onClick={() => setShowCompose(true)}>
 *         Compose Note
 *       </Button>
 *
 *       <ComposeDialog
 *         open={showCompose}
 *         onOpenChange={setShowCompose}
 *         replyTo={replyTo}
 *         kind={1}
 *         onPublish={(event) => {
 *           console.log("Published:", event);
 *         }}
 *       />
 *     </>
 *   );
 * }
 * ```
 *
 * ## Threading Behavior
 *
 * The dialog automatically handles different threading protocols:
 *
 * **Kind 1 (Notes) - NIP-10:**
 * - Adds ["e", root-id, relay, "root"] tag
 * - Adds ["e", reply-id, relay, "reply"] tag
 * - Adds ["p", pubkey] for all mentioned users
 *
 * **All Other Kinds - NIP-22:**
 * - Adds ["K", kind] tag
 * - Adds ["E", event-id, relay, pubkey] or ["A", coordinate, relay]
 * - Adds ["p", pubkey] for all mentioned users
 * - Adds deprecated ["k", kind] for compatibility
 *
 * ## Props
 *
 * - `open: boolean` - Whether dialog is open
 * - `onOpenChange: (open: boolean) => void` - Callback when open state changes
 * - `replyTo?: NostrEvent` - Event being replied to (optional)
 * - `kind?: number` - Event kind to create (default: 1)
 * - `initialContent?: string` - Pre-filled content
 * - `onPublish?: (event: NostrEvent) => void` - Callback after successful publish
 */

export { ComposeDialog } from "../ComposeDialog";
export type { ComposeDialogProps } from "../ComposeDialog";

export { PowerTools } from "../PowerTools";
export type { PowerToolsProps } from "../PowerTools";

export { RelaySelector } from "../RelaySelector";
export type { RelaySelectorProps } from "../RelaySelector";

export {
  buildThreadTags,
  buildNip10Tags,
  buildNip22Tags,
} from "@/lib/thread-builder";
export type { ThreadTags } from "@/lib/thread-builder";
