import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

/**
 * Inline badge-style node view for Nostr event previews (used in MentionEditor)
 *
 * Shows a compact badge with event type and truncated identifier.
 * Replaces direct DOM manipulation with a React component.
 */
export function NostrEventPreviewInline({ node }: ReactNodeViewProps) {
  const { type, data } = node.attrs as {
    type: "note" | "nevent" | "naddr";
    data: any;
  };

  let typeLabel: string;
  let contentLabel: string;

  if (type === "note" || type === "nevent") {
    typeLabel = "event";
    contentLabel =
      type === "note" ? data?.slice(0, 8) : data?.id?.slice(0, 8) || "";
  } else if (type === "naddr") {
    typeLabel = "address";
    contentLabel = data?.identifier || data?.pubkey?.slice(0, 8) || "";
  } else {
    typeLabel = "ref";
    contentLabel = "";
  }

  return (
    <NodeViewWrapper
      as="span"
      className="nostr-event-preview inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30 text-xs align-middle"
      contentEditable={false}
    >
      <span className="text-primary font-medium">{typeLabel}</span>
      <span className="text-muted-foreground truncate max-w-[140px]">
        {contentLabel}
      </span>
    </NodeViewWrapper>
  );
}
