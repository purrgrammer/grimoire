/**
 * MarkdownToolbar - Formatting toolbar for markdown editors
 *
 * Provides buttons for common markdown formatting operations:
 * - Bold, Italic, Code (inline)
 * - Heading, Link, Quote, List (block)
 *
 * Works with TipTap editor by inserting markdown syntax at cursor.
 */

import { useCallback } from "react";
import {
  Bold,
  Italic,
  Code,
  Link,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Editor } from "@tiptap/react";

export interface MarkdownToolbarProps {
  editor: Editor | null;
  /** Whether preview mode is active */
  showPreview?: boolean;
  /** Toggle preview mode */
  onTogglePreview?: () => void;
  /** Additional class name */
  className?: string;
  /** Disable all buttons */
  disabled?: boolean;
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ToolbarButton({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  active,
}: ToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={onClick}
          disabled={disabled}
          type="button"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>
          {label}
          {shortcut && (
            <span className="ml-2 text-muted-foreground">{shortcut}</span>
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function MarkdownToolbar({
  editor,
  showPreview,
  onTogglePreview,
  className = "",
  disabled = false,
}: MarkdownToolbarProps) {
  // Wrap selection with markdown syntax
  const wrapSelection = useCallback(
    (before: string, after: string = before) => {
      if (!editor) return;

      const { from, to, empty } = editor.state.selection;

      if (empty) {
        // No selection - insert placeholder
        editor
          .chain()
          .focus()
          .insertContent(`${before}text${after}`)
          .setTextSelection({
            from: from + before.length,
            to: from + before.length + 4,
          })
          .run();
      } else {
        // Wrap selection
        const selectedText = editor.state.doc.textBetween(from, to);
        editor
          .chain()
          .focus()
          .deleteSelection()
          .insertContent(`${before}${selectedText}${after}`)
          .run();
      }
    },
    [editor],
  );

  // Insert at start of line(s)
  const insertAtLineStart = useCallback(
    (prefix: string) => {
      if (!editor) return;

      const { from } = editor.state.selection;

      // Find the start of the current line
      const $from = editor.state.doc.resolve(from);
      const lineStart = $from.start();

      editor.chain().focus().insertContentAt(lineStart, prefix).run();
    },
    [editor],
  );

  // Insert link with placeholder
  const insertLink = useCallback(() => {
    if (!editor) return;

    const { from, to, empty } = editor.state.selection;

    if (empty) {
      // No selection - insert placeholder link
      editor
        .chain()
        .focus()
        .insertContent("[link text](url)")
        .setTextSelection({ from: from + 1, to: from + 10 })
        .run();
    } else {
      // Use selection as link text
      const selectedText = editor.state.doc.textBetween(from, to);
      editor
        .chain()
        .focus()
        .deleteSelection()
        .insertContent(`[${selectedText}](url)`)
        .setTextSelection({
          from: from + selectedText.length + 3,
          to: from + selectedText.length + 6,
        })
        .run();
    }
  }, [editor]);

  // Check if editor has a specific mark active
  const isActive = useCallback(
    (mark: string) => {
      if (!editor) return false;
      return editor.isActive(mark);
    },
    [editor],
  );

  const isDisabled = disabled || !editor;

  return (
    <div
      className={`flex items-center gap-0.5 border-b border-border pb-2 mb-2 ${className}`}
    >
      {/* Text formatting */}
      <ToolbarButton
        icon={<Bold className="h-4 w-4" />}
        label="Bold"
        shortcut="Ctrl+B"
        onClick={() => wrapSelection("**")}
        disabled={isDisabled}
        active={isActive("bold")}
      />
      <ToolbarButton
        icon={<Italic className="h-4 w-4" />}
        label="Italic"
        shortcut="Ctrl+I"
        onClick={() => wrapSelection("*")}
        disabled={isDisabled}
        active={isActive("italic")}
      />
      <ToolbarButton
        icon={<Code className="h-4 w-4" />}
        label="Inline code"
        shortcut="Ctrl+`"
        onClick={() => wrapSelection("`")}
        disabled={isDisabled}
        active={isActive("code")}
      />

      <div className="w-px h-5 bg-border mx-1" />

      {/* Block formatting */}
      <ToolbarButton
        icon={<Heading2 className="h-4 w-4" />}
        label="Heading"
        onClick={() => insertAtLineStart("## ")}
        disabled={isDisabled}
      />
      <ToolbarButton
        icon={<Quote className="h-4 w-4" />}
        label="Quote"
        onClick={() => insertAtLineStart("> ")}
        disabled={isDisabled}
      />
      <ToolbarButton
        icon={<List className="h-4 w-4" />}
        label="Bullet list"
        onClick={() => insertAtLineStart("- ")}
        disabled={isDisabled}
      />
      <ToolbarButton
        icon={<ListOrdered className="h-4 w-4" />}
        label="Numbered list"
        onClick={() => insertAtLineStart("1. ")}
        disabled={isDisabled}
      />

      <div className="w-px h-5 bg-border mx-1" />

      {/* Link */}
      <ToolbarButton
        icon={<Link className="h-4 w-4" />}
        label="Insert link"
        shortcut="Ctrl+K"
        onClick={insertLink}
        disabled={isDisabled}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Preview toggle */}
      {onTogglePreview && (
        <Button
          variant={showPreview ? "secondary" : "ghost"}
          size="sm"
          onClick={onTogglePreview}
          disabled={disabled}
          className="h-8 px-2 gap-1.5"
          type="button"
        >
          {showPreview ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          <span className="text-xs">Preview</span>
        </Button>
      )}
    </div>
  );
}
