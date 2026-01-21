import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { nip19 } from "nostr-tools";
import profileCache from "@/services/profile-cache";
import { getDisplayName } from "@/lib/nostr-utils";

/**
 * Helper to get display name for a pubkey (synchronous lookup from cache)
 */
function getDisplayNameForPubkey(pubkey: string): string {
  // Check profile cache first (includes Dexie + EventStore profiles)
  const cachedProfile = profileCache.get(pubkey);
  if (cachedProfile) {
    return getDisplayName(pubkey, cachedProfile);
  }

  // Fallback to placeholder format
  return getDisplayName(pubkey, undefined);
}

/**
 * Paste handler extension to transform bech32 strings into preview nodes
 *
 * Detects and transforms:
 * - npub/nprofile → @mention nodes
 * - note/nevent/naddr → nostrEventPreview nodes
 */
export const NostrPasteHandler = Extension.create({
  name: "nostrPasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("nostrPasteHandler"),

        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;

            // Regex to detect nostr bech32 strings (with or without nostr: prefix)
            const bech32Regex =
              /(?:nostr:)?(npub1[\w]{58,}|note1[\w]{58,}|nevent1[\w]+|naddr1[\w]+|nprofile1[\w]+)/g;
            const matches = Array.from(text.matchAll(bech32Regex));

            if (matches.length === 0) return false; // No bech32 found, use default paste

            // Build content with text and preview nodes
            const nodes: any[] = [];
            let lastIndex = 0;

            for (const match of matches) {
              const matchedText = match[0];
              const matchIndex = match.index!;
              const bech32 = match[1]; // The bech32 without nostr: prefix

              // Add text before this match
              if (lastIndex < matchIndex) {
                const textBefore = text.slice(lastIndex, matchIndex);
                if (textBefore) {
                  nodes.push(view.state.schema.text(textBefore));
                }
              }

              // Try to decode bech32 and create preview node
              try {
                const decoded = nip19.decode(bech32);

                // For npub/nprofile, create regular mention nodes (reuse existing infrastructure)
                if (decoded.type === "npub") {
                  const pubkey = decoded.data as string;
                  const displayName = getDisplayNameForPubkey(pubkey);
                  nodes.push(
                    view.state.schema.nodes.mention.create({
                      id: pubkey,
                      label: displayName,
                    }),
                  );
                } else if (decoded.type === "nprofile") {
                  const pubkey = (decoded.data as any).pubkey;
                  const displayName = getDisplayNameForPubkey(pubkey);
                  nodes.push(
                    view.state.schema.nodes.mention.create({
                      id: pubkey,
                      label: displayName,
                    }),
                  );
                } else if (decoded.type === "note") {
                  nodes.push(
                    view.state.schema.nodes.nostrEventPreview.create({
                      type: "note",
                      data: decoded.data,
                    }),
                  );
                } else if (decoded.type === "nevent") {
                  nodes.push(
                    view.state.schema.nodes.nostrEventPreview.create({
                      type: "nevent",
                      data: decoded.data,
                    }),
                  );
                } else if (decoded.type === "naddr") {
                  nodes.push(
                    view.state.schema.nodes.nostrEventPreview.create({
                      type: "naddr",
                      data: decoded.data,
                    }),
                  );
                }

                // Add space after preview node
                nodes.push(view.state.schema.text(" "));
              } catch (err) {
                // Invalid bech32, insert as plain text
                console.warn(
                  "[NostrPasteHandler] Failed to decode:",
                  bech32,
                  err,
                );
                nodes.push(view.state.schema.text(matchedText));
              }

              lastIndex = matchIndex + matchedText.length;
            }

            // Add remaining text after last match
            if (lastIndex < text.length) {
              const textAfter = text.slice(lastIndex);
              if (textAfter) {
                nodes.push(view.state.schema.text(textAfter));
              }
            }

            // Insert all nodes at cursor position
            if (nodes.length > 0) {
              const { tr } = view.state;
              const { from } = view.state.selection;

              // Insert content and track position
              let insertPos = from;
              nodes.forEach((node) => {
                tr.insert(insertPos, node);
                insertPos += node.nodeSize;
              });

              // Move cursor to end of inserted content
              tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos)));

              view.dispatch(tr);
              return true; // Prevent default paste
            }

            return false;
          },
        },
      }),
    ];
  },
});
