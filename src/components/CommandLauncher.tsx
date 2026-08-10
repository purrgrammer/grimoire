import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useAtom } from "jotai";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useLocation } from "react-router";
import db from "@/services/db";
import { useGrimoire } from "@/core/state";
import { manPages } from "@/types/man";
import { parseCommandInput, executeCommandParser } from "@/lib/command-parser";
import { commandLauncherEditModeAtom } from "@/core/command-launcher-state";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import "./command-launcher.css";

/** Check if current path doesn't have the window system (should navigate to / when launching commands) */
function isNonDashboardRoute(pathname: string): boolean {
  // /run route - pop-out command page
  if (pathname.startsWith("/run")) return true;

  // NIP-19 preview routes are single-segment paths starting with npub1, note1, nevent1, naddr1
  const segment = pathname.slice(1); // Remove leading /
  if (segment.includes("/")) return false; // Multi-segment paths are not NIP-19 previews
  return (
    segment.startsWith("npub1") ||
    segment.startsWith("note1") ||
    segment.startsWith("nevent1") ||
    segment.startsWith("naddr1")
  );
}

interface CommandLauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommandLauncher({
  open,
  onOpenChange,
}: CommandLauncherProps) {
  const [input, setInput] = useState("");
  // A failed argParser used to only reach the console, so a command that could
  // not run looked identical to one that did nothing.
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [editMode, setEditMode] = useAtom(commandLauncherEditModeAtom);
  const { state, addWindow, updateWindow } = useGrimoire();
  const navigate = useNavigate();
  const location = useLocation();

  // Fetch spells with aliases
  const aliasedSpells =
    useLiveQuery(() =>
      db.spells
        .toArray()
        .then((spells) =>
          spells.filter((s) => s.alias !== undefined && s.alias !== ""),
        ),
    ) || [];

  // Prefill input when entering edit mode
  useEffect(() => {
    if (open && editMode) {
      setInput(editMode.initialCommand);
    } else if (!open) {
      // Clear input and edit mode when dialog closes
      setInput("");
      setError(null);
      setEditMode(null);
    }
  }, [open, editMode, setEditMode]);

  // Parse input into command and arguments
  const parsed = parseCommandInput(input);
  const { commandName } = parsed;

  // Check if it's a spell alias
  const activeSpell = aliasedSpells.find(
    (s) => s.alias?.toLowerCase() === commandName.toLowerCase(),
  );

  // Re-parse if it's a spell
  const effectiveParsed = activeSpell
    ? parseCommandInput(
        activeSpell.command +
          (input.trim().includes(" ")
            ? " " + input.trim().split(/\s+/).slice(1).join(" ")
            : ""),
      )
    : parsed;

  const recognizedCommand = effectiveParsed.command;

  // Filter commands by partial match on command name only
  const filteredCommands = [
    ...Object.entries(manPages),
    ...aliasedSpells.map((s) => [
      s.alias!,
      {
        name: s.alias!,
        synopsis: s.alias!,
        description: s.name || s.description || "",
        category: "Spells",
        appId: "req",
        spellCommand: s.command,
      } as any,
    ]),
  ].filter(([name]) => name.toLowerCase().includes(commandName.toLowerCase()));

  // Execute command (async to support async argParsers)
  const executeCommand = async () => {
    if (!recognizedCommand || isExecuting) return;

    setError(null);
    setIsExecuting(true);

    // Execute argParser and get props/title
    let result;
    try {
      result = await executeCommandParser(
        effectiveParsed,
        state.activeAccount?.pubkey,
      );
    } finally {
      setIsExecuting(false);
    }

    if (result.error || !result.props) {
      // A parser message is often the whole answer — "2 installed napplets
      // handle 'profile': pick one" is the reply, not a malfunction — so it
      // goes to the palette's own footer, which stays open to be read.
      const message = result.error || "Failed to parse command arguments";
      console.error("Failed to parse command:", message);
      setError(message);
      return;
    }

    // Edit mode: update existing window
    // `result.command`, not `recognizedCommand`: an argParser may redirect to a
    // different app (see APP_ID_OVERRIDE), and `recognizedCommand` is the
    // pre-parse snapshot that predates the substitution.
    const appId = result.command?.appId ?? recognizedCommand.appId;

    if (editMode) {
      updateWindow(editMode.windowId, {
        props: result.props,
        commandString: activeSpell ? effectiveParsed.fullInput : input.trim(),
        appId,
        customTitle: result.globalFlags?.windowProps?.title,
      });
      setEditMode(null); // Clear edit mode
    } else {
      // If on a non-dashboard route (no window system), navigate to dashboard first
      // The window will appear after navigation since state persists
      if (isNonDashboardRoute(location.pathname)) {
        navigate("/");
      }

      // Normal mode: create new window
      addWindow(
        appId,
        result.props,
        activeSpell ? effectiveParsed.fullInput : input.trim(),
        result.globalFlags?.windowProps?.title,
        activeSpell?.id,
      );
    }

    onOpenChange(false);
  };

  // Handle item selection (populate input, don't execute) - a tap must not run
  // a command that still needs arguments.
  const handleSelect = (selectedCommand: string) => {
    setInput(selectedCommand + " ");
    setError(null);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setError(null);
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand();
    }
    // cmdk's root keydown claims Home/End to jump the list selection. Keep
    // them as caret movement — this is a command line, not a menu.
    if (e.key === "Home" || e.key === "End") {
      e.stopPropagation();
    }
  };

  // Define category order: Nostr first, then Spells, then Documentation, then System
  const categoryOrder = ["Nostr", "Spells", "Documentation", "System"];
  const categories = Array.from(
    new Set(filteredCommands.map(([_, cmd]) => cmd.category)),
  ).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a as string);
    const indexB = categoryOrder.indexOf(b as string);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  // Dynamic placeholder
  const placeholder = recognizedCommand
    ? activeSpell
      ? activeSpell.command
      : recognizedCommand.synopsis
    : "Type a command...";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grimoire-command-launcher p-0">
        <VisuallyHidden>
          <DialogTitle>Command Launcher</DialogTitle>
        </VisuallyHidden>
        <Command
          label="Command Launcher"
          className="grimoire-command-content"
          shouldFilter={false}
        >
          <div className="command-launcher-wrapper">
            <Command.Input
              value={input}
              onValueChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="command-input"
              autoFocus
            />

            <Command.List className="command-list">
              <Command.Empty className="command-empty">
                {commandName
                  ? `No command found: ${commandName}`
                  : "Start typing..."}
              </Command.Empty>

              {categories.map((category) => (
                <Command.Group
                  key={category}
                  heading={category}
                  className="command-group"
                >
                  {filteredCommands
                    .filter(([_, cmd]) => cmd.category === category)
                    .map(([name, cmd]) => {
                      const isExactMatch = name === commandName;
                      return (
                        <Command.Item
                          key={name}
                          value={name}
                          onSelect={() => handleSelect(name)}
                          className="command-item"
                          data-exact-match={isExactMatch}
                        >
                          <div className="command-item-content">
                            <div className="command-item-name">
                              <span className="command-name">{name}</span>
                              {cmd.synopsis !== name && (
                                <span className="command-args">
                                  {cmd.synopsis.replace(name, "").trim()}
                                </span>
                              )}
                              {isExactMatch && (
                                <span className="command-match-indicator">
                                  ✓
                                </span>
                              )}
                            </div>
                            {cmd.description && (
                              <div className="command-item-description">
                                {cmd.description.split(".")[0]}
                              </div>
                            )}
                            {cmd.spellCommand && (
                              <div className="text-xs md:text-[10px] opacity-50 font-mono truncate mt-0.5">
                                {cmd.spellCommand}
                              </div>
                            )}
                          </div>
                        </Command.Item>
                      );
                    })}
                </Command.Group>
              ))}
            </Command.List>

            <div className="command-footer">
              {error ? (
                <div className="command-footer-error" role="alert">
                  {error}
                </div>
              ) : (
                <div className="hidden md:block">
                  <kbd>↑↓</kbd> navigate
                  <kbd>↵</kbd> execute
                  <kbd>esc</kbd> close
                </div>
              )}
              {recognizedCommand && (
                /* Enter is the only way in on a soft keyboard that does not
                   deliver one; the status line is the button. */
                <button
                  type="button"
                  className="command-footer-status"
                  onClick={() => void executeCommand()}
                  disabled={isExecuting}
                >
                  {isExecuting ? "Executing…" : "Run"}
                </button>
              )}
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
