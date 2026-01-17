/**
 * Relay Authentication Pre-Check Manager
 *
 * Purpose: Ensure relays are authenticated BEFORE heavy operations (gift wrap sync)
 * to prevent AUTH prompts from blocking UI during concurrent decryption/IndexedDB writes.
 *
 * Strategy:
 * 1. Send dummy REQ to trigger AUTH challenge
 * 2. Wait for AUTH flow to complete
 * 3. Return list of successfully authenticated relays
 * 4. Timeout after 5s to avoid waiting for dead relays
 */

import { firstValueFrom, timeout, catchError, of, take } from "rxjs";
import pool from "./relay-pool";
import eventStore from "./event-store";
import { dmDebug, dmInfo, dmWarn } from "@/lib/dm-debug";

/** Result of relay authentication check */
export interface RelayAuthResult {
  /** Relay URL */
  url: string;
  /** Whether authentication succeeded */
  authenticated: boolean;
  /** Error message if authentication failed */
  error?: string;
  /** Time taken to authenticate (ms) */
  duration?: number;
}

/**
 * Pre-authenticate a single relay by sending a dummy request.
 * This triggers the AUTH flow if required, allowing user to approve before heavy operations.
 *
 * @param relayUrl - Relay to authenticate
 * @param userPubkey - User's pubkey for dummy request
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Authentication result
 */
export async function preAuthenticateRelay(
  relayUrl: string,
  userPubkey: string,
  timeoutMs = 5000,
): Promise<RelayAuthResult> {
  const startTime = performance.now();

  try {
    dmDebug("RelayAuth", `Pre-authenticating ${relayUrl}...`);

    // Send a minimal dummy request to trigger AUTH if needed
    // Use kind 0 (metadata) with limit 1 - very lightweight
    const dummyFilter = {
      kinds: [0],
      authors: [userPubkey],
      limit: 1,
    };

    // Execute request with timeout
    // pool.request() returns an Observable that completes after EOSE
    // If AUTH is required, it will be challenged during this request
    await firstValueFrom(
      pool.request([relayUrl], [dummyFilter], { eventStore }).pipe(
        take(1), // Take first event or EOSE
        timeout(timeoutMs),
        catchError((err) => {
          dmWarn(
            "RelayAuth",
            `Auth check failed for ${relayUrl}: ${err.message}`,
          );
          return of(null);
        }),
      ),
    );

    const duration = performance.now() - startTime;
    dmInfo(
      "RelayAuth",
      `✅ ${relayUrl} authenticated in ${duration.toFixed(0)}ms`,
    );

    return {
      url: relayUrl,
      authenticated: true,
      duration,
    };
  } catch (err) {
    const duration = performance.now() - startTime;
    const error = err instanceof Error ? err.message : "Unknown error";

    dmWarn(
      "RelayAuth",
      `❌ ${relayUrl} auth failed after ${duration.toFixed(0)}ms: ${error}`,
    );

    return {
      url: relayUrl,
      authenticated: false,
      error,
      duration,
    };
  }
}

/**
 * Pre-authenticate multiple relays in parallel.
 * Returns list of successfully authenticated relays.
 *
 * @param relayUrls - Relays to authenticate
 * @param userPubkey - User's pubkey for dummy requests
 * @param concurrency - Maximum concurrent auth checks (default: 5)
 * @returns Authentication results for all relays
 */
export async function preAuthenticateRelays(
  relayUrls: string[],
  userPubkey: string,
  concurrency = 5,
): Promise<RelayAuthResult[]> {
  if (relayUrls.length === 0) return [];

  dmInfo("RelayAuth", `Pre-authenticating ${relayUrls.length} relays...`);

  // Execute authentication checks with limited concurrency
  const results = await limitConcurrency(
    relayUrls.map((url) => () => preAuthenticateRelay(url, userPubkey)),
    concurrency,
  );

  const successCount = results.filter((r) => r.authenticated).length;
  const failCount = results.length - successCount;

  dmInfo(
    "RelayAuth",
    `Auth complete: ${successCount} succeeded, ${failCount} failed`,
  );

  return results;
}

/**
 * Get list of successfully authenticated relays from auth results
 */
export function getAuthenticatedRelays(results: RelayAuthResult[]): string[] {
  return results.filter((r) => r.authenticated).map((r) => r.url);
}

/**
 * Get list of failed relays from auth results
 */
export function getFailedRelays(results: RelayAuthResult[]): string[] {
  return results.filter((r) => !r.authenticated).map((r) => r.url);
}

/**
 * Run promises with limited concurrency
 * @param tasks Array of functions that return promises
 * @param limit Maximum concurrent promises
 */
async function limitConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result);
      // Remove from executing array when done
      const index = executing.indexOf(promise);
      if (index !== -1) {
        executing.splice(index, 1);
      }
    });
    executing.push(promise);

    // Wait if we've reached the concurrency limit
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  // Wait for all remaining promises to complete
  await Promise.all(executing);
  return results;
}
