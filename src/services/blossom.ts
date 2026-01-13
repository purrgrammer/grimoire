/**
 * Blossom Service
 *
 * Wraps blossom-client-sdk for blob storage operations.
 * Integrates with Grimoire's account system for signing.
 *
 * Key features:
 * - Upload blobs to user's configured Blossom servers
 * - List blobs for a pubkey
 * - Check server health
 * - Mirror blobs between servers
 * - Manage user server lists (kind 10063)
 */

import {
  BlossomClient,
  type BlobDescriptor,
  type SignedEvent,
  getServersFromServerListEvent,
} from "blossom-client-sdk";
import type { EventTemplate } from "nostr-tools/core";
import accountManager from "./accounts";
import eventStore from "./event-store";
import { addressLoader } from "./loaders";
import type { Subscription } from "rxjs";

/** Kind for user's Blossom server list (BUD-03) */
export const USER_SERVER_LIST_KIND = 10063;

/** Re-export types from SDK */
export type { BlobDescriptor, SignedEvent };

/**
 * Server info parsed from kind 10063 event
 */
export interface BlossomServerInfo {
  url: string;
  // Future: could add server-specific metadata
}

/**
 * Result of an upload operation
 */
export interface UploadResult {
  blob: BlobDescriptor;
  server: string;
}

/**
 * Result of checking a server
 */
export interface ServerCheckResult {
  url: string;
  online: boolean;
  error?: string;
  responseTime?: number;
}

/**
 * Get signer function for the active account
 * Compatible with blossom-client-sdk's signer interface
 */
function getActiveSigner():
  | ((event: EventTemplate) => Promise<SignedEvent>)
  | null {
  const account = accountManager.active;
  if (!account?.signer) return null;

  return async (event: EventTemplate): Promise<SignedEvent> => {
    const signer = account.signer;
    if (!signer) throw new Error("No signer available");

    // applesauce signers have a signEvent method
    const signed = await signer.signEvent(event);
    return signed as SignedEvent;
  };
}

/**
 * Get user's Blossom servers from their kind 10063 event
 */
export function getServersFromEvent(event: { tags: string[][] }): string[] {
  // SDK returns URL objects, convert to strings
  const urls = getServersFromServerListEvent(event);
  return urls.map((url) => url.toString());
}

/**
 * Fetch user's Blossom server list from the network
 * Returns servers from kind 10063 event
 */
export async function fetchUserServers(pubkey: string): Promise<string[]> {
  return new Promise((resolve) => {
    let subscription: Subscription | null = null;
    let resolved = false;

    // Set a timeout to resolve with empty array if no response
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        subscription?.unsubscribe();

        // Check if we have the event in store
        const event = eventStore.getReplaceable(
          USER_SERVER_LIST_KIND,
          pubkey,
          "",
        );
        if (event) {
          resolve(getServersFromEvent(event));
        } else {
          resolve([]);
        }
      }
    }, 5000);

    subscription = addressLoader({
      kind: USER_SERVER_LIST_KIND,
      pubkey,
      identifier: "",
    }).subscribe({
      next: () => {
        // Event arrived, check store
        const event = eventStore.getReplaceable(
          USER_SERVER_LIST_KIND,
          pubkey,
          "",
        );
        if (event && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          subscription?.unsubscribe();
          resolve(getServersFromEvent(event));
        }
      },
      error: () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve([]);
        }
      },
    });
  });
}

/**
 * Check if a Blossom server is online and responsive
 */
export async function checkServer(
  serverUrl: string,
): Promise<ServerCheckResult> {
  const url = serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`;
  const start = Date.now();

  try {
    // Try to fetch a non-existent blob - server should respond with 404
    // This tests basic connectivity without requiring auth
    const response = await fetch(
      `${url}0000000000000000000000000000000000000000000000000000000000000000`,
      {
        method: "HEAD",
        signal: AbortSignal.timeout(10000),
      },
    );

    const responseTime = Date.now() - start;

    // 404 is expected for non-existent blob, 200 would mean blob exists
    // Both indicate server is online
    if (response.status === 404 || response.status === 200) {
      return { url: serverUrl, online: true, responseTime };
    }

    return {
      url: serverUrl,
      online: false,
      error: `Unexpected status: ${response.status}`,
      responseTime,
    };
  } catch (error) {
    return {
      url: serverUrl,
      online: false,
      error: error instanceof Error ? error.message : "Unknown error",
      responseTime: Date.now() - start,
    };
  }
}

/**
 * Upload a file to a Blossom server
 * Requires an active account with signer
 */
export async function uploadBlob(
  file: File,
  serverUrl: string,
): Promise<UploadResult> {
  const signer = getActiveSigner();
  if (!signer) {
    throw new Error("No active account or signer available");
  }

  const client = new BlossomClient(serverUrl, signer);
  const blob = await client.uploadBlob(file);

  return {
    blob,
    server: serverUrl,
  };
}

/**
 * Upload a file to multiple servers
 * Returns results for each server (success or error)
 */
export async function uploadBlobToServers(
  file: File,
  servers: string[],
): Promise<{
  results: UploadResult[];
  errors: { server: string; error: string }[];
}> {
  const signer = getActiveSigner();
  if (!signer) {
    throw new Error("No active account or signer available");
  }

  const results: UploadResult[] = [];
  const errors: { server: string; error: string }[] = [];

  // Upload to servers in parallel
  const uploads = servers.map(async (server) => {
    try {
      const client = new BlossomClient(server, signer);
      const blob = await client.uploadBlob(file);
      results.push({ blob, server });
    } catch (error) {
      errors.push({
        server,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  await Promise.all(uploads);

  return { results, errors };
}

/**
 * List blobs uploaded by a pubkey from a server
 */
export async function listBlobs(
  serverUrl: string,
  pubkey: string,
  options?: { limit?: number; since?: number; until?: number },
): Promise<BlobDescriptor[]> {
  const signer = getActiveSigner();

  // BlossomClient can work without signer for listing public blobs
  const client = new BlossomClient(serverUrl, signer || undefined);

  const blobs = await client.listBlobs(pubkey, options);
  return blobs;
}

/**
 * Delete a blob from a server
 * Requires the blob to have been uploaded by the active account
 */
export async function deleteBlob(
  serverUrl: string,
  sha256: string,
): Promise<void> {
  const signer = getActiveSigner();
  if (!signer) {
    throw new Error("No active account or signer available");
  }

  const client = new BlossomClient(serverUrl, signer);
  await client.deleteBlob(sha256);
}

/**
 * Mirror a blob from one URL to a server
 * The sourceUrl should be a Blossom blob URL (server/<sha256>)
 */
export async function mirrorBlob(
  sourceUrl: string,
  targetServer: string,
): Promise<BlobDescriptor> {
  const signer = getActiveSigner();
  if (!signer) {
    throw new Error("No active account or signer available");
  }

  // Create a BlobDescriptor from the source URL
  // Extract sha256 from URL (format: https://server/<sha256> or https://server/<sha256>.ext)
  const urlObj = new URL(sourceUrl);
  const pathParts = urlObj.pathname.split("/").filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1];
  // Remove extension if present
  const sha256 = lastPart.replace(/\.[^.]+$/, "");

  if (!/^[0-9a-f]{64}$/i.test(sha256)) {
    throw new Error("Invalid blob URL - could not extract SHA256 hash");
  }

  const blobDescriptor: BlobDescriptor = {
    sha256: sha256.toLowerCase(),
    size: 0, // Unknown
    url: sourceUrl,
    uploaded: 0, // Unknown
  };

  const client = new BlossomClient(targetServer, signer);
  const result = await client.mirrorBlob(blobDescriptor);
  return result;
}

/**
 * Get a blob's URL on a specific server
 */
export function getBlobUrl(
  serverUrl: string,
  sha256: string,
  extension?: string,
): string {
  const base = serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`;
  return extension ? `${base}${sha256}.${extension}` : `${base}${sha256}`;
}

/**
 * Get the active account's configured Blossom servers
 * Fetches from kind 10063 if available
 */
export async function getActiveAccountServers(): Promise<string[]> {
  const account = accountManager.active;
  if (!account?.pubkey) return [];

  return fetchUserServers(account.pubkey);
}

// Default export for convenience
export default {
  USER_SERVER_LIST_KIND,
  getActiveSigner,
  getServersFromEvent,
  fetchUserServers,
  checkServer,
  uploadBlob,
  uploadBlobToServers,
  listBlobs,
  deleteBlob,
  mirrorBlob,
  getBlobUrl,
  getActiveAccountServers,
};
