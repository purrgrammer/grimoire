import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
  parseAndExecuteCommand,
  type ParsedCommand,
} from "@/lib/command-parser";
import { useGrimoire } from "@/core/state";
import { WindowRenderer } from "@/components/WindowRenderer";

/**
 * RunCommandPage - Standalone command execution route
 *
 * Route: /run?cmd=<command>
 *
 * Executes a command and displays the result without affecting the workspace layout.
 * This allows windows to be "popped out" into separate browser windows/tabs.
 */
export default function RunCommandPage() {
  const [searchParams] = useSearchParams();
  const { state } = useGrimoire();
  const [parsed, setParsed] = useState<ParsedCommand | null>(null);
  const [loading, setLoading] = useState(true);

  const cmdParam = searchParams.get("cmd");

  useEffect(() => {
    async function parseCommand() {
      if (!cmdParam) {
        setParsed({
          commandName: "",
          args: [],
          fullInput: "",
          error: "No command provided",
        });
        setLoading(false);
        return;
      }

      try {
        const result = await parseAndExecuteCommand(
          cmdParam,
          state.activeAccount?.pubkey,
        );
        setParsed(result);
      } catch (error) {
        setParsed({
          commandName: "",
          args: [],
          fullInput: cmdParam,
          error:
            error instanceof Error ? error.message : "Failed to parse command",
        });
      } finally {
        setLoading(false);
      }
    }

    parseCommand();
  }, [cmdParam, state.activeAccount?.pubkey]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading command...</div>
      </div>
    );
  }

  if (!parsed || parsed.error || !parsed.command || !parsed.props) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md rounded-lg border border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold text-destructive">
            Command Error
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            {parsed?.error || "Unknown error"}
          </p>
          {cmdParam && (
            <p className="text-xs font-mono text-muted-foreground">
              Command: {cmdParam}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Construct a minimal WindowInstance for rendering
  const windowInstance = {
    id: "pop-out",
    appId: parsed.command.appId,
    props: parsed.props,
    customTitle: parsed.globalFlags?.windowProps?.title,
    commandString: parsed.fullInput,
  };

  return (
    <WindowRenderer window={windowInstance} onClose={() => window.close()} />
  );
}
