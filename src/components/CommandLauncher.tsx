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

/** Check if current path is a NIP-19 preview route (no window system) */
function isNip19PreviewRoute(pathname: string): boolean {
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
    if (!recognizedCommand) return;

    // Execute argParser and get props/title
    const result = await executeCommandParser(
      effectiveParsed,
      state.activeAccount?.pubkey,
    );

    if (result.error || !result.props) {
      console.error("Failed to parse command:", result.error);
      return;
    }

    // Edit mode: update existing window
    if (editMode) {
      updateWindow(editMode.windowId, {
        props: result.props,
        commandString: activeSpell ? effectiveParsed.fullInput : input.trim(),
        appId: recognizedCommand.appId,
        customTitle: result.globalFlags?.windowProps?.title,
      });
      setEditMode(null); // Clear edit mode
    } else {
      // If on a NIP-19 preview route (no window system), navigate to dashboard first
      // The window will appear after navigation since state persists
      if (isNip19PreviewRoute(location.pathname)) {
        navigate("/");
      }

      // Normal mode: create new window
      addWindow(
        recognizedCommand.appId,
        result.props,
        activeSpell ? effectiveParsed.fullInput : input.trim(),
        result.globalFlags?.windowProps?.title,
        activeSpell?.id,
      );
    }

    onOpenChange(false);
  };

  // Handle item selection (populate input, don't execute)
  const handleSelect = (selectedCommand: string) => {
    setInput(selectedCommand + " ");
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeCommand();
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
              onValueChange={setInput}
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
                              <div className="text-[10px] opacity-50 font-mono truncate mt-0.5">
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
              <div>
                <kbd>↑↓</kbd> navigate
                <kbd>↵</kbd> execute
                <kbd>esc</kbd> close
              </div>
              {recognizedCommand && (
                <div className="command-footer-status">Ready to execute</div>
              )}
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
