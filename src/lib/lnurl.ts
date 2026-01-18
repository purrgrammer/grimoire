/**
 * LNURL utilities for Lightning address resolution and zap support (NIP-57)
 */

export interface LnUrlPayResponse {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  tag: "payRequest";
  allowsNostr?: boolean;
  nostrPubkey?: string;
  commentAllowed?: number;
}

export interface LnUrlCallbackResponse {
  pr: string; // BOLT11 invoice
  successAction?: {
    tag: string;
    message?: string;
  };
  routes?: any[];
}

/**
 * Resolve a Lightning address (lud16) to LNURL-pay endpoint data
 * Converts user@domain.com to https://domain.com/.well-known/lnurlp/user
 */
export async function resolveLightningAddress(
  address: string,
): Promise<LnUrlPayResponse> {
  const parts = address.split("@");
  if (parts.length !== 2) {
    throw new Error(
      "Invalid Lightning address format. Expected: user@domain.com",
    );
  }

  const [username, domain] = parts;
  const url = `https://${domain}/.well-known/lnurlp/${username}`;

  try {
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch LNURL data: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as LnUrlPayResponse;

    // Validate required fields
    if (data.tag !== "payRequest") {
      throw new Error(
        `Invalid LNURL response: expected tag "payRequest", got "${data.tag}"`,
      );
    }

    if (!data.callback) {
      throw new Error("LNURL response missing callback URL");
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error(
          "Lightning address request timed out. Please try again.",
        );
      }
      throw error;
    }
    throw new Error(`Failed to resolve Lightning address: ${error}`);
  }
}

/**
 * Decode LNURL (bech32-encoded URL) to plain HTTPS URL
 */
export function decodeLnurl(_lnurl: string): string {
  // For simplicity, we'll require Lightning addresses (lud16) instead of lud06
  // Most modern wallets use lud16 anyway
  throw new Error(
    "LNURL (lud06) not supported. Please use a Lightning address (lud16) instead.",
  );
}

/**
 * Fetch invoice from LNURL callback with zap request
 * @param callbackUrl - The callback URL from LNURL-pay response
 * @param amountMillisats - Amount in millisatoshis
 * @param zapRequestEvent - Signed kind 9734 zap request event (URL-encoded JSON)
 * @param comment - Optional comment (if allowed by LNURL service)
 */
export async function fetchInvoiceFromCallback(
  callbackUrl: string,
  amountMillisats: number,
  zapRequestEvent: string,
  comment?: string,
): Promise<LnUrlCallbackResponse> {
  // Build query parameters
  const url = new URL(callbackUrl);
  url.searchParams.set("amount", amountMillisats.toString());
  url.searchParams.set("nostr", zapRequestEvent);
  if (comment) {
    url.searchParams.set("comment", comment);
  }

  try {
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Failed to fetch invoice (${response.status}): ${errorText || response.statusText}`,
      );
    }

    const data = (await response.json()) as LnUrlCallbackResponse;

    if (!data.pr) {
      throw new Error("LNURL callback response missing invoice (pr field)");
    }

    return data;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new Error("Invoice request timed out. Please try again.");
      }
      throw error;
    }
    throw new Error(`Failed to fetch invoice from callback: ${error}`);
  }
}

/**
 * Validate that a LNURL service supports Nostr zaps (NIP-57)
 */
export function validateZapSupport(lnurlData: LnUrlPayResponse): void {
  if (!lnurlData.allowsNostr) {
    throw new Error(
      "This Lightning address does not support Nostr zaps (allowsNostr is false)",
    );
  }

  if (!lnurlData.nostrPubkey) {
    throw new Error("LNURL service missing nostrPubkey (required for zaps)");
  }

  // Validate pubkey format (64 hex chars)
  if (!/^[0-9a-f]{64}$/i.test(lnurlData.nostrPubkey)) {
    throw new Error("Invalid nostrPubkey format in LNURL response");
  }
}
