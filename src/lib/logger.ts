/**
 * Structured logging utility with log levels
 * Provides context-aware logging with timestamps and user context
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  timestamp: string;
  context: string;
  user?: string;
  action?: string;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context: LogContext;
  data?: unknown;
}

class Logger {
  private context: string;
  private static logs: LogEntry[] = [];
  private static maxLogs = 100; // Keep last 100 logs in memory

  constructor(context: string) {
    this.context = context;
  }

  private getLogContext(action?: string): LogContext {
    const ctx: LogContext = {
      timestamp: new Date().toISOString(),
      context: this.context,
    };

    // Try to get active user from state
    try {
      const state = localStorage.getItem("grimoire_v6");
      if (state) {
        const parsed = JSON.parse(state);
        if (parsed.activeAccount?.pubkey) {
          ctx.user = parsed.activeAccount.pubkey.slice(0, 8); // First 8 chars for privacy
        }
      }
    } catch {
      // Ignore localStorage errors
    }

    if (action) {
      ctx.action = action;
    }

    return ctx;
  }

  private log(
    level: LogLevel,
    message: string,
    data?: unknown,
    action?: string,
  ) {
    const logContext = this.getLogContext(action);
    const entry: LogEntry = {
      level,
      message,
      context: logContext,
      data,
    };

    // Store in memory for debugging
    Logger.logs.push(entry);
    if (Logger.logs.length > Logger.maxLogs) {
      Logger.logs.shift();
    }

    // Format for console
    const prefix = `[${logContext.timestamp}] [${logContext.context}]`;
    const userInfo = logContext.user ? ` [user:${logContext.user}]` : "";
    const actionInfo = logContext.action
      ? ` [action:${logContext.action}]`
      : "";
    const fullPrefix = `${prefix}${userInfo}${actionInfo}`;

    const logMessage =
      data !== undefined ? [fullPrefix, message, data] : [fullPrefix, message];

    switch (level) {
      case "debug":
        // Only log debug in development
        if (import.meta.env.DEV) {
          console.log(...logMessage);
        }
        break;
      case "info":
        console.log(...logMessage);
        break;
      case "warn":
        console.warn(...logMessage);
        break;
      case "error":
        console.error(...logMessage);
        break;
    }
  }

  debug(message: string, data?: unknown, action?: string) {
    this.log("debug", message, data, action);
  }

  info(message: string, data?: unknown, action?: string) {
    this.log("info", message, data, action);
  }

  warn(message: string, data?: unknown, action?: string) {
    this.log("warn", message, data, action);
  }

  error(message: string, error?: unknown, action?: string) {
    this.log("error", message, error, action);
  }

  /**
   * Get recent logs for debugging
   */
  static getRecentLogs(level?: LogLevel): LogEntry[] {
    if (level) {
      return Logger.logs.filter((log) => log.level === level);
    }
    return [...Logger.logs];
  }

  /**
   * Clear logs from memory
   */
  static clearLogs() {
    Logger.logs = [];
  }

  /**
   * Export logs as JSON for debugging
   */
  static exportLogs(): string {
    return JSON.stringify(Logger.logs, null, 2);
  }
}

/**
 * Create a logger for a specific context
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
