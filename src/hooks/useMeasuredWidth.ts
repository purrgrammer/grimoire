import { useCallback, useState } from "react";

/**
 * The measured content width of an element, and the ref that measures it.
 *
 * Observed, not measured once: a mosaic split resizes its tiles continuously as
 * the divider is dragged, and a phone changes width when it is turned.
 *
 * A ref CALLBACK rather than a ref plus a mount effect, and that is the whole
 * point of the hook. A component that returns early while it loads does not have
 * its box in the DOM on the render that mounts it, so `useEffect(..., [])`
 * reading `ref.current` finds null and — with no dependency to re-run on — never
 * looks again. The width then stays `undefined` for the component's whole life,
 * and every layout decision downstream silently falls back to its unmeasured
 * default. The callback fires whenever the node actually mounts, however many
 * renders later that is.
 */
export function useMeasuredWidth(): [
  ref: (node: HTMLElement | null) => void,
  width: number | undefined,
] {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
