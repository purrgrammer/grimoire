/**
 * LNURL helpers for NIP-57 Lightning Zaps
 *
 * Implements LNURL-pay protocol with Nostr zap support
 */

interface LNURLPayResponse {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  tag: "payRequest";
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

interface LNURLCallbackResponse {
  pr: string; // BOLT11 invoice
  successAction?: {
    tag: string;
    message?: string;
  };
  routes?: any[];
  status?: "ERROR";
  reason?: string;
}

/**
 * Decode LNURL (bech32) or lightning address to HTTPS URL
 */
function decodeLNURL(lnurl: string): string {
  // If it looks like an email address (user@domain.com), it's a lightning address
  if (lnurl.includes("@")) {
    const [user, domain] = lnurl.split("@");
    return `https://${domain}/.well-known/lnurlp/${user}`;
  }

  // If it starts with LNURL, decode bech32
  if (lnurl.toLowerCase().startsWith("lnurl")) {
    // For now, we'll focus on lightning addresses which are more common
    throw new Error(
      "LNURL bech32 decoding not yet implemented. Please use lightning address (user@domain.com)",
    );
  }

  // Assume it's already a URL
  return lnurl;
}

/**
 * Fetch LNURL endpoint and check if it supports Nostr zaps
 *
 * @param lnurl Lightning address (user@domain.com) or LNURL
 * @returns Zap endpoint URL or null if not supported
 */
export async function getZapEndpoint(lnurl: string): Promise<string | null> {
  try {
    const url = decodeLNURL(lnurl);
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`LNURL fetch failed: ${response.statusText}`);
      return null;
    }

    const data: LNURLPayResponse = await response.json();

    if (data.tag !== "payRequest") {
      console.error("Invalid LNURL response: not a payRequest");
      return null;
    }

    // Check if Nostr zaps are supported
    if (!data.allowsNostr) {
      console.warn("LNURL endpoint does not support Nostr zaps");
      return null;
    }

    if (!data.nostrPubkey) {
      console.warn("LNURL endpoint missing nostrPubkey");
      return null;
    }

    return data.callback;
  } catch (error) {
    console.error("Failed to fetch LNURL endpoint:", error);
    return null;
  }
}

/**
 * Request an invoice from LNURL callback
 *
 * @param callback LNURL callback URL
 * @param amountMsats Amount in millisatoshis
 * @param zapRequest Signed NIP-57 zap request event (kind 9734)
 * @returns BOLT11 invoice or null
 */
export async function requestInvoice(
  callback: string,
  amountMsats: number,
  zapRequest: any,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      amount: String(amountMsats),
      nostr: JSON.stringify(zapRequest),
    });

    const response = await fetch(`${callback}?${params.toString()}`);

    if (!response.ok) {
      console.error(`LNURL callback failed: ${response.statusText}`);
      return null;
    }

    const data: LNURLCallbackResponse = await response.json();

    if (data.status === "ERROR") {
      console.error(`LNURL error: ${data.reason}`);
      return null;
    }

    if (!data.pr) {
      console.error("LNURL callback did not return invoice");
      return null;
    }

    return data.pr;
  } catch (error) {
    console.error("Failed to request invoice:", error);
    return null;
  }
}
