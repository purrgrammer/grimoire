import { useEffect, type ReactNode } from "react";
import { useFloating, offset, flip, shift } from "@floating-ui/react-dom";
import { createPortal } from "react-dom";

interface SuggestionPopoverProps {
  /** Function that returns the cursor bounding rect (from Tiptap suggestion) */
  clientRect: (() => DOMRect | null) | null;
  /** Popover content (suggestion list component) */
  children: ReactNode;
  /** Floating-ui placement */
  placement?: "bottom-start" | "top-start";
}

/**
 * Generic floating popover for suggestion dropdowns
 *
 * Uses @floating-ui/react-dom with a virtual reference element (cursor position)
 * to position suggestion lists. Rendered via React portal.
 */
export function SuggestionPopover({
  clientRect,
  children,
  placement = "bottom-start",
}: SuggestionPopoverProps) {
  const { refs, floatingStyles } = useFloating({
    placement,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  // Update virtual reference element when clientRect changes
  useEffect(() => {
    if (clientRect) {
      refs.setReference({
        getBoundingClientRect: () => clientRect() || new DOMRect(),
      });
    }
  }, [clientRect, refs]);

  return createPortal(
    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
      {children}
    </div>,
    document.body,
  );
}
