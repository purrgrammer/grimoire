import { Component, ReactNode, ErrorInfo } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: "app" | "window";
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, level = "window" } = this.props;

    // Log to console for development
    console.error(`[ErrorBoundary:${level}] Caught error:`, error, errorInfo);

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, level = "window" } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // App-level error: full screen error
      if (level === "app") {
        return (
          <div className="h-screen w-screen flex items-center justify-center bg-background p-8">
            <div className="max-w-2xl w-full border border-destructive bg-card p-8 space-y-6">
              <div className="flex items-center gap-3 text-destructive">
                <AlertTriangle className="h-8 w-8" />
                <h1 className="text-2xl font-bold">Application Error</h1>
              </div>

              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Grimoire encountered a critical error and cannot continue. You
                  can try reloading the application or clearing your browser
                  data.
                </p>

                {error && (
                  <div className="bg-muted p-4 font-mono text-xs overflow-auto max-h-48">
                    <div className="text-destructive font-semibold mb-2">
                      {error.name}: {error.message}
                    </div>
                    {error.stack && (
                      <pre className="text-muted-foreground whitespace-pre-wrap">
                        {error.stack}
                      </pre>
                    )}
                  </div>
                )}

                {errorInfo?.componentStack && (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">
                      Component Stack
                    </summary>
                    <pre className="mt-2 text-xs bg-muted p-4 overflow-auto max-h-48">
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={this.handleReload}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reload Application
                </button>
                <button
                  onClick={() => {
                    localStorage.clear();
                    this.handleReload();
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-border hover:bg-accent"
                >
                  <Home className="h-4 w-4" />
                  Reset & Reload
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                If this problem persists, please report it on GitHub with the
                error details above.
              </p>
            </div>
          </div>
        );
      }

      // Window-level error: inline error display
      return (
        <div className="h-full w-full flex items-center justify-center p-4 bg-background">
          <div className="max-w-lg w-full border border-destructive/50 bg-card p-6 space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Window Error</h2>
            </div>

            <p className="text-sm text-muted-foreground">
              This window encountered an error. You can try reopening it or
              continue using other windows.
            </p>

            {error && (
              <div className="bg-muted p-3 font-mono text-xs">
                <div className="text-destructive font-semibold">
                  {error.name}: {error.message}
                </div>
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
