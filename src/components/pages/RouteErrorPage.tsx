import { isRouteErrorResponse, useRouteError, Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "../ui/button";

/**
 * Rendered for any unmatched or failed route. Without this react-router falls
 * back to its own developer-facing error screen, outside the app shell.
 */
export default function RouteErrorPage() {
  const error = useRouteError();

  const isNotFound = isRouteErrorResponse(error) && error.status === 404;
  const status = isRouteErrorResponse(error) ? error.status : undefined;

  const message = isNotFound
    ? "That path doesn't resolve to anything."
    : isRouteErrorResponse(error)
      ? error.statusText || "Something went wrong loading this route."
      : error instanceof Error
        ? error.message
        : "Something went wrong loading this route.";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="size-8 text-muted-foreground" />

      <div className="space-y-1">
        <h1 className="font-mono text-lg">
          {status ? `${status} — ` : ""}
          {isNotFound ? "Not found" : "Route error"}
        </h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>

      <p className="max-w-md text-xs text-muted-foreground">
        Single-segment paths are treated as NIP-19 identifiers, so they must
        start with <code className="font-mono">npub1</code>,{" "}
        <code className="font-mono">note1</code>,{" "}
        <code className="font-mono">nevent1</code> or{" "}
        <code className="font-mono">naddr1</code>.
      </p>

      <Button asChild variant="outline">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}
