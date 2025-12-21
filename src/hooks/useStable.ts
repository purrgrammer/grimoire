import { useMemo } from "react";

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
export function useStableValue<T>(
  value: T,
  serialize?: (v: T) => string
): T {
  const serialized = serialize?.(value) ?? JSON.stringify(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [serialized]);
}

/**
 * Stabilize a string array for use in dependency arrays
 *
 * Optimized version of useStableValue for string arrays.
 * Uses join(",") instead of JSON.stringify for better performance.
 *
 * @param arr - The array to stabilize
 * @returns The memoized array
 *
 * @example
 * ```typescript
 * // Instead of: useMemo(() => relays, [relays.join(",")])
 * const stableRelays = useStableArray(relays);
 * ```
 */
export function useStableArray<T extends string>(arr: T[]): T[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => arr, [arr.join(",")]);
}

/**
 * Stabilize a Nostr filter or array of filters
 *
 * Specialized stabilizer for Nostr filters which are commonly
 * recreated on each render.
 *
 * @param filters - Single filter or array of filters
 * @returns The memoized filter(s)
 */
export function useStableFilters<T>(filters: T): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => filters, [JSON.stringify(filters)]);
}
