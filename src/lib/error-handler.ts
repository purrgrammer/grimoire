/**
 * Global Error Handler
 *
 * Captures and handles:
 * - Unhandled promise rejections
 * - Uncaught errors
 * - LocalStorage quota exceeded errors
 * - Network failures
 */

export interface ErrorContext {
  timestamp: Date;
  userAgent: string;
  url: string;
  activeAccount?: string;
  errorType: string;
}

export interface ErrorReport {
  error: Error | string;
  context: ErrorContext;
  stack?: string;
}

type ErrorCallback = (report: ErrorReport) => void;

class GlobalErrorHandler {
  private callbacks: ErrorCallback[] = [];
  private initialized = false;

  /**
   * Initialize global error handlers
   */
  initialize() {
    if (this.initialized) {
      console.warn("[ErrorHandler] Already initialized");
      return;
    }

    // Handle unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      event.preventDefault(); // Prevent default console error

      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason));

      this.report(error, "unhandled_rejection");
    });

    // Handle uncaught errors
    window.addEventListener("error", (event) => {
      event.preventDefault(); // Prevent default console error

      const error = event.error || new Error(event.message);
      this.report(error, "uncaught_error");
    });

    // Wrap localStorage methods to catch quota errors
    this.wrapLocalStorage();

    this.initialized = true;
    console.log("[ErrorHandler] Global error handler initialized");
  }

  /**
   * Register a callback to be notified of errors
   */
  onError(callback: ErrorCallback) {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Report an error
   */
  report(error: Error | string, errorType: string) {
    const report: ErrorReport = {
      error: error instanceof Error ? error : new Error(String(error)),
      context: {
        timestamp: new Date(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        errorType,
      },
      stack:
        error instanceof Error ? error.stack : new Error(String(error)).stack,
    };

    // Try to get active account from localStorage
    try {
      const state = localStorage.getItem("grimoire_v6");
      if (state) {
        const parsed = JSON.parse(state);
        report.context.activeAccount = parsed.activeAccount?.pubkey;
      }
    } catch {
      // Ignore localStorage read errors
    }

    // Log to console
    console.error("[ErrorHandler]", {
      type: errorType,
      error: report.error,
      context: report.context,
    });

    // Notify callbacks
    this.callbacks.forEach((callback) => {
      try {
        callback(report);
      } catch (err) {
        console.error("[ErrorHandler] Callback error:", err);
      }
    });
  }

  /**
   * Wrap localStorage methods to catch quota exceeded errors
   */
  private wrapLocalStorage() {
    const originalSetItem = localStorage.setItem.bind(localStorage);

    localStorage.setItem = (key: string, value: string) => {
      try {
        originalSetItem(key, value);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        ) {
          this.report(
            new Error(
              `LocalStorage quota exceeded while saving key: ${key} (${(value.length / 1024).toFixed(2)}KB)`,
            ),
            "localstorage_quota",
          );

          // Attempt to free space by removing old data
          this.handleQuotaExceeded();

          // Try again after cleanup
          try {
            originalSetItem(key, value);
          } catch (retryError) {
            // If still fails, notify user
            this.report(
              new Error(
                "LocalStorage quota exceeded even after cleanup. Data may be lost.",
              ),
              "localstorage_quota_critical",
            );
            throw retryError;
          }
        } else {
          this.report(error as Error, "localstorage_error");
          throw error;
        }
      }
    };
  }

  /**
   * Handle localStorage quota exceeded by removing old data
   */
  private handleQuotaExceeded() {
    console.warn(
      "[ErrorHandler] LocalStorage quota exceeded, attempting cleanup...",
    );

    try {
      // Strategy: Keep critical data, remove caches
      const keysToKeep = ["grimoire_v6"]; // Core state
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !keysToKeep.includes(key)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => {
        try {
          localStorage.removeItem(key);
          console.log(`[ErrorHandler] Removed localStorage key: ${key}`);
        } catch {
          // Ignore removal errors
        }
      });

      console.log(
        `[ErrorHandler] Removed ${keysToRemove.length} localStorage items`,
      );
    } catch (error) {
      console.error("[ErrorHandler] Failed to clean up localStorage:", error);
    }
  }

  /**
   * Clear all error callbacks (for testing)
   */
  clearCallbacks() {
    this.callbacks = [];
  }
}

// Export singleton instance
export const errorHandler = new GlobalErrorHandler();

/**
 * Initialize error handling with UI notifications
 */
export function initializeErrorHandling() {
  errorHandler.initialize();

  // Register default callback for user notifications
  errorHandler.onError((report) => {
    const error = report.error;
    const { errorType } = report.context;

    // Critical errors that require user attention
    if (errorType === "localstorage_quota_critical") {
      showErrorToast(
        "Storage Full",
        "Your browser storage is full. Some data may not be saved. Consider clearing browser data or exporting your settings.",
        "error",
      );
    } else if (errorType === "localstorage_quota") {
      showErrorToast(
        "Storage Warning",
        "Browser storage is nearly full. Old data was cleaned up automatically.",
        "warning",
      );
    } else if (errorType === "unhandled_rejection") {
      // Only show user-facing promise rejections
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("fetch") || errorMessage.includes("relay")) {
        showErrorToast(
          "Network Error",
          "Failed to connect to relay or fetch data. Please check your connection.",
          "error",
        );
      }
    }
  });
}

/**
 * Show error toast notification
 */
function showErrorToast(
  title: string,
  message: string,
  type: "error" | "warning" = "error",
) {
  // Dynamic import to avoid circular dependency
  import("sonner").then(({ toast }) => {
    if (type === "error") {
      toast.error(title, { description: message, duration: 5000 });
    } else {
      toast.warning(title, { description: message, duration: 5000 });
    }
  });
}
