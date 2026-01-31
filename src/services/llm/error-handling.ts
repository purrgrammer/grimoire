/**
 * LLM Error Handling
 *
 * Centralized error handling with retry logic for LLM API calls.
 * Supports exponential backoff, rate limit handling, and transient error recovery.
 */

// ─────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────

export interface LLMError {
  /** Human-readable error message */
  message: string;
  /** HTTP status code if applicable */
  status?: number;
  /** Whether this error can be retried */
  retryable: boolean;
  /** Suggested wait time before retry (ms) */
  retryAfter?: number;
  /** Original error for debugging */
  originalError?: unknown;
}

export type ErrorCategory =
  | "auth" // 401, 403 - API key issues
  | "billing" // 402 - Payment required
  | "not_found" // 404 - Model not found
  | "rate_limit" // 429 - Rate limited
  | "server" // 5xx - Server errors
  | "network" // Connection issues
  | "timeout" // Request timeout
  | "cancelled" // User cancelled
  | "unknown"; // Catch-all

// ─────────────────────────────────────────────────────────────
// Error Detection
// ─────────────────────────────────────────────────────────────

/**
 * Categorize an error for handling.
 */
export function categorizeError(error: unknown): ErrorCategory {
  // Aborted requests
  if (error instanceof DOMException && error.name === "AbortError") {
    return "cancelled";
  }

  // Timeout
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }

  // Check for HTTP status codes (OpenAI SDK error shape)
  if (isAPIError(error)) {
    const status = error.status;
    if (status === 401 || status === 403) return "auth";
    if (status === 402) return "billing";
    if (status === 404) return "not_found";
    if (status === 429) return "rate_limit";
    if (status >= 500 && status < 600) return "server";
  }

  // Network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return "network";
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("network") || msg.includes("connection")) return "network";
    if (msg.includes("timeout")) return "timeout";
    if (msg.includes("rate") && msg.includes("limit")) return "rate_limit";
  }

  return "unknown";
}

/**
 * Check if an error is from the OpenAI API (duck typing).
 */
function isAPIError(
  error: unknown,
): error is { status: number; message?: string; headers?: Headers } {
  return (
    error !== null &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
}

/**
 * Check if an error category is retryable.
 */
export function isRetryable(category: ErrorCategory): boolean {
  return (
    category === "rate_limit" ||
    category === "server" ||
    category === "network" ||
    category === "timeout"
  );
}

// ─────────────────────────────────────────────────────────────
// Error Parsing
// ─────────────────────────────────────────────────────────────

/**
 * Parse an error into a structured LLMError.
 */
export function parseError(error: unknown): LLMError {
  const category = categorizeError(error);
  const retryable = isRetryable(category);

  // Extract retry-after from rate limit response
  let retryAfter: number | undefined;
  if (category === "rate_limit" && isAPIError(error)) {
    retryAfter = extractRetryAfter(error);
  }

  // Default backoff for retryable errors without explicit retry-after
  if (retryable && !retryAfter) {
    retryAfter = getDefaultBackoff(category);
  }

  return {
    message: getErrorMessage(error, category),
    status: isAPIError(error) ? error.status : undefined,
    retryable,
    retryAfter,
    originalError: error,
  };
}

/**
 * Extract retry-after header from API error.
 */
function extractRetryAfter(error: { headers?: Headers }): number | undefined {
  if (!error.headers) return undefined;

  const retryAfter = error.headers.get?.("retry-after");
  if (!retryAfter) return undefined;

  // Can be seconds or HTTP date
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as date
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

/**
 * Get default backoff time for a category.
 */
function getDefaultBackoff(category: ErrorCategory): number {
  switch (category) {
    case "rate_limit":
      return 5000; // 5 seconds
    case "server":
      return 2000; // 2 seconds
    case "network":
    case "timeout":
      return 1000; // 1 second
    default:
      return 1000;
  }
}

/**
 * Get user-friendly error message.
 */
function getErrorMessage(error: unknown, category: ErrorCategory): string {
  switch (category) {
    case "auth":
      return "Invalid API key. Please check your credentials.";
    case "billing":
      return "Insufficient balance. Please top up your account.";
    case "not_found":
      return "Model not found. Please select a different model.";
    case "rate_limit":
      return "Rate limit exceeded. Retrying automatically...";
    case "server":
      return "Provider service is temporarily unavailable. Retrying...";
    case "network":
      return "Network error. Please check your connection.";
    case "timeout":
      return "Request timed out. Retrying...";
    case "cancelled":
      return "Request was cancelled.";
    default:
      if (error instanceof Error) {
        return error.message;
      }
      return "An unknown error occurred.";
  }
}

// ─────────────────────────────────────────────────────────────
// Retry Logic
// ─────────────────────────────────────────────────────────────

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Jitter factor (0-1) to add randomness */
  jitter: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: 0.2,
};

/**
 * Calculate backoff delay with exponential increase and jitter.
 */
export function calculateBackoff(
  attempt: number,
  suggestedDelay?: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): number {
  // Use suggested delay if provided (e.g., from Retry-After header)
  if (suggestedDelay && suggestedDelay > 0) {
    return Math.min(suggestedDelay, config.maxDelay);
  }

  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);

  // Add jitter to prevent thundering herd
  const jitterRange = exponentialDelay * config.jitter;
  const jitter = Math.random() * jitterRange * 2 - jitterRange;

  return Math.min(exponentialDelay + jitter, config.maxDelay);
}

/**
 * Wait for the specified duration.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Retry State for UI
// ─────────────────────────────────────────────────────────────

export interface RetryState {
  /** Current retry attempt (0 = initial, 1+ = retry) */
  attempt: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** Whether currently waiting before retry */
  waiting: boolean;
  /** Time remaining until next retry (ms) */
  waitTimeRemaining: number;
  /** Last error that triggered retry */
  lastError?: LLMError;
}

/**
 * Create a retry state tracker for UI updates.
 */
export function createRetryState(
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): RetryState {
  return {
    attempt: 0,
    maxAttempts: config.maxRetries + 1, // +1 for initial attempt
    waiting: false,
    waitTimeRemaining: 0,
  };
}
