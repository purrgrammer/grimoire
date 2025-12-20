/**
 * Structured logging utility with log levels
 * Only logs debug messages in development mode
 */

type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    // Format message
    const prefix = `[${this.context}]`;
    const logMessage =
      data !== undefined ? [prefix, message, data] : [prefix, message];

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
        // Could send to error tracking service here
        break;
    }
  }

  debug(message: string, data?: unknown) {
    this.log("debug", message, data);
  }

  info(message: string, data?: unknown) {
    this.log("info", message, data);
  }

  warn(message: string, data?: unknown) {
    this.log("warn", message, data);
  }

  error(message: string, error?: unknown) {
    this.log("error", message, error);
  }
}

/**
 * Create a logger for a specific context
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
