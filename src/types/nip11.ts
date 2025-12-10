/**
 * NIP-11: Relay Information Document
 * https://github.com/nostr-protocol/nips/blob/master/11.md
 */

export interface RelayInformation {
  /** DNS name of the relay */
  name?: string;

  /** Description of the relay in plain text */
  description?: string;

  /** Public key of the relay administrator */
  pubkey?: string;

  /** Administrative contact for the relay */
  contact?: string;

  /** List of NIPs supported by this relay */
  supported_nips?: number[];

  /** Software version running the relay */
  software?: string;

  /** Software version identifier */
  version?: string;

  /** Relay limitations and policies */
  limitation?: RelayLimitation;

  /** Payment information for paid relays */
  payments_url?: string;

  /** Relay usage fees */
  fees?: RelayFees;

  /** URL to the relay's icon */
  icon?: string;
}

export interface RelayLimitation {
  /** Maximum length of the content field */
  max_message_length?: number;

  /** Maximum number of subscriptions per WebSocket connection */
  max_subscriptions?: number;

  /** Maximum number of filters per subscription */
  max_filters?: number;

  /** Maximum length of subscription ID */
  max_subid_length?: number;

  /** Minimum prefix length for search filters */
  min_prefix?: number;

  /** Maximum number of elements in various arrays */
  max_limit?: number;

  /** Minimum POW difficulty for events */
  min_pow_difficulty?: number;

  /** Whether authentication is required */
  auth_required?: boolean;

  /** Whether payment is required */
  payment_required?: boolean;

  /** Restricted write access */
  restricted_writes?: boolean;

  /** Created at lower limit (oldest events accepted) */
  created_at_lower_limit?: number;

  /** Created at upper limit (newest events accepted) */
  created_at_upper_limit?: number;
}

export interface RelayFees {
  /** Admission fee structure */
  admission?: Array<{ amount: number; unit: string }>;

  /** Subscription fee structure */
  subscription?: Array<{ amount: number; unit: string; period?: number }>;

  /** Publication fee structure */
  publication?: Array<{ kinds?: number[]; amount: number; unit: string }>;
}

export interface CachedRelayInfo {
  /** Relay URL (websocket) */
  url: string;

  /** Relay information document */
  info: RelayInformation;

  /** Timestamp when the info was fetched */
  fetchedAt: number;
}
