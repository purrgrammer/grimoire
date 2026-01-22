import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { nip19 } from "nostr-tools";
import profileSearch from "@/services/profile-search";
import { getDisplayName } from "@/lib/nostr-utils";

/**
 * Helper to get display name for a pubkey (synchronous lookup from cache)
 */
function getDisplayNameForPubkey(pubkey: string): string {
  // Check profile search cache (includes Dexie + EventStore profiles)
  const cachedProfile = profileSearch.getByPubkey(pubkey);
  if (cachedProfile) {
    return cachedProfile.displayName;
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
            // Only match entities surrounded by whitespace or at string boundaries
            // to avoid matching entities within URLs (e.g., https://njump.me/npub1...)
            // Note: Using (^|\s) capture group instead of lookbehind for Safari compatibility
            const bech32Regex =
              /(^|\s)(?:nostr:)?(npub1[\w]{58,}|note1[\w]{58,}|nevent1[\w]+|naddr1[\w]+|nprofile1[\w]+)(?=$|\s)/g;
            const matches = Array.from(text.matchAll(bech32Regex));

            if (matches.length === 0) return false; // No bech32 found, use default paste

            // Build content with text and preview nodes
            const nodes: any[] = [];
            let lastIndex = 0;

            for (const match of matches) {
              const fullMatch = match[0];
              const boundary = match[1]; // Leading whitespace or empty (start of string)
              const bech32 = match[2]; // The bech32 without nostr: prefix
              const matchIndex = match.index!;

              // Add text before this match (including the boundary whitespace)
              const textBeforeEnd = matchIndex + boundary.length;
              if (lastIndex < textBeforeEnd) {
                const textBefore = text.slice(lastIndex, textBeforeEnd);
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
                // Invalid bech32, insert as plain text (entity portion without boundary)
                console.warn(
                  "[NostrPasteHandler] Failed to decode:",
                  bech32,
                  err,
                );
                const entityText = fullMatch.slice(boundary.length);
                nodes.push(view.state.schema.text(entityText));
              }

              lastIndex = matchIndex + fullMatch.length;
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
