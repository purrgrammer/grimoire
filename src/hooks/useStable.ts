import { useMemo, useRef } from "react";
import { isFilterEqual } from "applesauce-core/helpers/filter";
import type { Filter } from "nostr-tools";

/**
 * Stabilize a value for use in dependency arrays
 *
 * React's useEffect/useMemo compare dependencies by reference.
 * For objects/arrays that are recreated each render but have the same content,
 * this causes unnecessary re-runs. This hook memoizes the value based on
 * a serialized representation.
 *
 * @param value - The value to stabilize
 * @param serialize - Optional custom serializer (defaults to JSON.stringify)
 * @returns The memoized value
 *
 * @example
 * ```typescript
 * // Instead of: useMemo(() => filters, [JSON.stringify(filters)])
 * const stableFilters = useStableValue(filters);
 * ```
 */
export function useStableValue<T>(value: T, serialize?: (v: T) => string): T {
  const serialized = serialize?.(value) ?? JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [serialized]);
}

/**
 * Stabilize a string array for use in dependency arrays
 *
 * Uses JSON.stringify for safe serialization (handles arrays with commas in elements).
 *
 * @param arr - The array to stabilize
 * @returns The memoized array
 *
 * @example
 * ```typescript
 * // Instead of: useMemo(() => relays, [JSON.stringify(relays)])
 * const stableRelays = useStableArray(relays);
 * ```
 */
export function useStableArray<T extends string>(arr: T[]): T[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => arr, [JSON.stringify(arr)]);
}

/**
 * Stabilize a Nostr filter or array of filters
 *
 * Uses applesauce's isFilterEqual for robust filter comparison.
 * Better than JSON.stringify as it handles undefined values correctly
 * and supports NIP-ND AND operator.
 *
 * @param filters - Single filter or array of filters
 * @returns The memoized filter(s)
 */
export function useStableFilters<T extends Filter | Filter[]>(filters: T): T {
  const prevFiltersRef = useRef<T>();

  // Only update if filters actually changed (per isFilterEqual)
  if (
    !prevFiltersRef.current ||
    !isFilterEqual(prevFiltersRef.current as Filter | Filter[], filters as Filter | Filter[])
  ) {
    prevFiltersRef.current = filters;
  }

  return prevFiltersRef.current;
}
