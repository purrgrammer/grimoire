import { useEffect, useRef, type ReactNode } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  size,
} from "@floating-ui/react-dom";
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
 *
 * Uses autoUpdate to keep position correct during scroll/resize, and a
 * size middleware to constrain max-height to available viewport space.
 */
export function SuggestionPopover({
  clientRect,
  children,
  placement = "bottom-start",
}: SuggestionPopoverProps) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const { refs, floatingStyles, update } = useFloating({
    placement,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.max(100, availableHeight)}px`;
        },
      }),
    ],
  });

  // Set up virtual reference and auto-update when clientRect changes
  useEffect(() => {
    // Clean up previous auto-update
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!clientRect) return;

    const virtualEl = {
      getBoundingClientRect: () => clientRect() || new DOMRect(),
    };

    refs.setReference(virtualEl);

    // Start auto-update for scroll/resize tracking
    const floating = refs.floating.current;
    if (floating) {
      cleanupRef.current = autoUpdate(virtualEl, floating, update, {
        ancestorScroll: true,
        ancestorResize: true,
        elementResize: true,
        animationFrame: false,
      });
    }

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [clientRect, refs, update]);

  return createPortal(
    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }}>
      {children}
    </div>,
    document.body,
  );
}
