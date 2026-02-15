import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  CodeSquare,
  Link,
  Unlink,
  Minus,
  Eye,
  Pencil,
} from "lucide-react";

interface MarkdownToolbarProps {
  editor: Editor | null;
  preview: boolean;
  onTogglePreview: () => void;
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        // Prevent stealing focus from editor
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-primary/20 text-primary"
          : disabled
            ? "text-muted-foreground/40 cursor-not-allowed"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <div className="w-px h-5 bg-border mx-0.5" />;
}

/**
 * Formatting toolbar for the MarkdownEditor.
 * Provides buttons for common markdown formatting, link insertion,
 * and a preview toggle.
 */
export function MarkdownToolbar({
  editor,
  preview,
  onTogglePreview,
}: MarkdownToolbarProps) {
  const [linkInput, setLinkInput] = useState<{
    open: boolean;
    url: string;
  }>({ open: false, url: "" });

  const isActive = useCallback(
    (name: string, attrs?: Record<string, any>) => {
      if (!editor) return false;
      return editor.isActive(name, attrs);
    },
    [editor],
  );

  const run = useCallback(
    (command: (chain: any) => any) => {
      if (!editor) return;
      command(editor.chain().focus());
    },
    [editor],
  );

  const handleLinkSubmit = useCallback(() => {
    if (!editor || !linkInput.url) {
      setLinkInput({ open: false, url: "" });
      return;
    }

    // Ensure URL has a protocol
    let url = linkInput.url.trim();
    if (url && !/^https?:\/\//.test(url)) {
      url = `https://${url}`;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkInput({ open: false, url: "" });
  }, [editor, linkInput.url]);

  const handleUnlink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetLink().run();
    setLinkInput({ open: false, url: "" });
  }, [editor]);

  const disabled = !editor || preview;
  const iconSize = "size-4";

  return (
    <div className="flex flex-col border-b border-border">
      <div className="flex items-center gap-0.5 px-2 py-1 flex-wrap">
        {/* Inline marks */}
        <ToolbarButton
          onClick={() => run((c) => c.toggleBold().run())}
          active={isActive("bold")}
          disabled={disabled}
          title="Bold (Ctrl+B)"
        >
          <Bold className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleItalic().run())}
          active={isActive("italic")}
          disabled={disabled}
          title="Italic (Ctrl+I)"
        >
          <Italic className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleStrike().run())}
          active={isActive("strike")}
          disabled={disabled}
          title="Strikethrough"
        >
          <Strikethrough className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleCode().run())}
          active={isActive("code")}
          disabled={disabled}
          title="Inline code"
        >
          <Code className={iconSize} />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Headings */}
        <ToolbarButton
          onClick={() => run((c) => c.toggleHeading({ level: 1 }).run())}
          active={isActive("heading", { level: 1 })}
          disabled={disabled}
          title="Heading 1"
        >
          <Heading1 className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleHeading({ level: 2 }).run())}
          active={isActive("heading", { level: 2 })}
          disabled={disabled}
          title="Heading 2"
        >
          <Heading2 className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleHeading({ level: 3 }).run())}
          active={isActive("heading", { level: 3 })}
          disabled={disabled}
          title="Heading 3"
        >
          <Heading3 className={iconSize} />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Block elements */}
        <ToolbarButton
          onClick={() => run((c) => c.toggleBulletList().run())}
          active={isActive("bulletList")}
          disabled={disabled}
          title="Bullet list"
        >
          <List className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleOrderedList().run())}
          active={isActive("orderedList")}
          disabled={disabled}
          title="Ordered list"
        >
          <ListOrdered className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleBlockquote().run())}
          active={isActive("blockquote")}
          disabled={disabled}
          title="Blockquote"
        >
          <Quote className={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => run((c) => c.toggleCodeBlock().run())}
          active={isActive("codeBlock")}
          disabled={disabled}
          title="Code block"
        >
          <CodeSquare className={iconSize} />
        </ToolbarButton>

        <ToolbarSeparator />

        {/* Link */}
        {isActive("link") ? (
          <ToolbarButton
            onClick={handleUnlink}
            active
            disabled={disabled}
            title="Remove link"
          >
            <Unlink className={iconSize} />
          </ToolbarButton>
        ) : (
          <ToolbarButton
            onClick={() => {
              if (disabled) return;
              // Get existing link href if cursor is on a link
              const attrs = editor?.getAttributes("link");
              setLinkInput({
                open: true,
                url: attrs?.href || "",
              });
            }}
            disabled={disabled}
            title="Insert link"
          >
            <Link className={iconSize} />
          </ToolbarButton>
        )}

        {/* Horizontal rule */}
        <ToolbarButton
          onClick={() => run((c) => c.setHorizontalRule().run())}
          disabled={disabled}
          title="Horizontal rule"
        >
          <Minus className={iconSize} />
        </ToolbarButton>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Preview toggle */}
        <ToolbarButton
          onClick={onTogglePreview}
          active={preview}
          title={preview ? "Edit" : "Preview"}
        >
          {preview ? (
            <Pencil className={iconSize} />
          ) : (
            <Eye className={iconSize} />
          )}
        </ToolbarButton>
      </div>

      {/* Link input row */}
      {linkInput.open && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-border bg-muted/30">
          <Link className="size-3.5 text-muted-foreground flex-shrink-0" />
          <input
            type="url"
            value={linkInput.url}
            onChange={(e) =>
              setLinkInput((s) => ({ ...s, url: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleLinkSubmit();
              } else if (e.key === "Escape") {
                setLinkInput({ open: false, url: "" });
              }
            }}
            placeholder="https://example.com"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
          <button
            type="button"
            onClick={handleLinkSubmit}
            className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded hover:bg-primary/30"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setLinkInput({ open: false, url: "" })}
            className="text-xs px-2 py-0.5 text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
