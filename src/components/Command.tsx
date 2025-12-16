import { useState } from "react";
import { useGrimoire } from "@/core/state";
import { manPages } from "@/types/man";
import { AppId } from "@/types/app";

interface CommandProps {
  name: string;
  args?: string;
  description: string;
  appId?: AppId;
  props?: any;
  commandLine?: string; // Full command with args (e.g., "decode npub1...")
}

export default function Command({
  name,
  args,
  description,
  appId,
  props,
  commandLine,
}: CommandProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const { addWindow } = useGrimoire();

  const handleClick = async () => {
    if (commandLine) {
      // Parse and execute the full command line
      const parts = commandLine.trim().split(/\s+/);
      const commandName = parts[0]?.toLowerCase();
      const cmdArgs = parts.slice(1);

      const command = manPages[commandName];
      if (command) {
        // argParser can now be async
        const cmdProps = command.argParser
          ? await Promise.resolve(command.argParser(cmdArgs))
          : command.defaultProps || {};

        addWindow(command.appId, cmdProps);
      }
    } else if (appId) {
      // Open the specified app with given props
      addWindow(appId, props || {});
    } else {
      // Default: open man page
      addWindow("man", { cmd: name });
    }
  };

  return (
    <div className="relative inline-block">
      <button
        className="px-2 py-1 border border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-colors cursor-crosshair font-mono text-sm uppercase"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={handleClick}
      >
        {name}
      </button>

      {showTooltip && (
        <div className="absolute z-10 top-full mt-2 left-0 bg-popover border border-border p-3 shadow-lg min-w-64">
          <div className="font-mono text-xs space-y-1">
            <div className="text-primary font-semibold">
              {name}{" "}
              {args && <span className="text-muted-foreground">{args}</span>}
            </div>
            <div className="text-muted-foreground">{description}</div>
          </div>
        </div>
      )}
    </div>
  );
}
