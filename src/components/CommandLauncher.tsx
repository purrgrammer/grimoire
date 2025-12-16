import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useAtom } from "jotai";
import { useGrimoire } from "@/core/state";
import { manPages } from "@/types/man";
import { parseCommandInput, executeCommandParser } from "@/lib/command-parser";
import { commandLauncherEditModeAtom } from "@/core/command-launcher-state";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import "./command-launcher.css";

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
  const { addWindow, updateWindow } = useGrimoire();

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
  const recognizedCommand = parsed.command;

  // Filter commands by partial match on command name only
  const filteredCommands = Object.entries(manPages).filter(([name]) =>
    name.toLowerCase().includes(commandName.toLowerCase()),
  );

  // Execute command (async to support async argParsers)
  const executeCommand = async () => {
    if (!recognizedCommand) return;

    // Execute argParser and get props/title
    const result = await executeCommandParser(parsed);

    if (result.error || !result.props) {
      console.error("Failed to parse command:", result.error);
      return;
    }

    // Edit mode: update existing window
    if (editMode) {
      updateWindow(editMode.windowId, {
        props: result.props,
        title: result.title,
        commandString: input.trim(),
        appId: recognizedCommand.appId,
      });
      setEditMode(null); // Clear edit mode
    } else {
      // Normal mode: create new window
      addWindow(
        recognizedCommand.appId,
        result.props,
        result.title,
        input.trim(),
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

  // Define category order: Nostr first, then Documentation, then System
  const categoryOrder = ["Nostr", "Documentation", "System"];
  const categories = Array.from(
    new Set(filteredCommands.map(([_, cmd]) => cmd.category)),
  ).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  // Dynamic placeholder
  const placeholder = recognizedCommand
    ? recognizedCommand.synopsis
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
                            <div className="command-item-description">
                              {cmd.description.split(".")[0]}
                            </div>
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
