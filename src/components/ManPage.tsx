import { manPages, type ManPageEntry } from "@/types/man";
import { useAddWindow } from "@/core/state";
import { CenteredContent } from "./ui/CenteredContent";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Fragment, useMemo } from "react";

interface ManPageProps {
  cmd: string;
}

/**
 * ExecutableCommand - Renders a clickable command that executes when clicked
 */
export function ExecutableCommand({
  commandLine,
  className,
  children,
  spellId,
}: {
  commandLine: string;
  className?: string;
  children: React.ReactNode;
  spellId?: string;
}) {
  const addWindow = useAddWindow();

  const handleClick = async () => {
    const parts = commandLine.trim().split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const cmdArgs = parts.slice(1);

    const command = manPages[commandName];
    if (command) {
      // argParser can be async
      const cmdProps = command.argParser
        ? await Promise.resolve(command.argParser(cmdArgs))
        : command.defaultProps || {};

      addWindow(command.appId, cmdProps, undefined, undefined, spellId);
    }
  };

  return (
    <Button
      onClick={handleClick}
      variant="link"
      className={cn(
        "text-accent font-medium hover:underline cursor-crosshair text-left",
        className,
      )}
    >
      {children}
    </Button>
  );
}

function CommandIndex() {
  const grouped = useMemo(() => {
    const groups: Record<string, { name: string; entry: ManPageEntry }[]> = {};
    for (const [name, entry] of Object.entries(manPages)) {
      const cat = entry.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ name, entry });
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
  }, []);

  // Order categories consistently
  const categoryOrder = ["Documentation", "Nostr", "System"] as const;

  return (
    <CenteredContent maxWidth="4xl" spacing="4" className="font-mono text-sm">
      {/* Header */}
      <div className="flex justify-between border-b border-border pb-2">
        <span className="font-bold">GRIMOIRE(1)</span>
        <span className="text-muted-foreground">Grimoire Manual</span>
        <span className="font-bold">GRIMOIRE(1)</span>
      </div>

      {/* NAME */}
      <section>
        <h2 className="font-bold mb-2">NAME</h2>
        <div className="ml-8">grimoire - a nostr client for magicians</div>
      </section>

      {/* DESCRIPTION */}
      <section>
        <h2 className="font-bold mb-2">DESCRIPTION</h2>
        <div className="ml-8 text-muted-foreground">
          Grimoire is a Nostr protocol explorer and developer tool. Press Cmd+K
          to launch commands. Type &quot;man &lt;command&gt;&quot; for details.
        </div>
      </section>

      {/* COMMANDS */}
      <section>
        <h2 className="font-bold mb-2">COMMANDS</h2>
        <div className="ml-4 space-y-4">
          {categoryOrder.map((category) => {
            const commands = grouped[category];
            if (!commands) return null;
            return (
              <div key={category}>
                <div className="text-muted-foreground mb-1 ml-2">
                  {category}
                </div>
                <div className="ml-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 items-baseline">
                  {commands.map(({ name, entry }) => (
                    <Fragment key={name}>
                      <ExecutableCommand
                        commandLine={`man ${name}`}
                        className="p-0 h-auto justify-start"
                      >
                        {name}
                      </ExecutableCommand>
                      <span className="text-muted-foreground">
                        {entry.description.split(".")[0]}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </CenteredContent>
  );
}

export default function ManPage({ cmd }: ManPageProps) {
  if (cmd === "help") {
    return <CommandIndex />;
  }

  const page = manPages[cmd];

  if (!page) {
    return (
      <CenteredContent maxWidth="4xl" spacing="4" className="font-mono text-sm">
        <div className="text-destructive">No manual entry for {cmd}</div>
        <div className="mt-4 text-muted-foreground">
          Use 'help' to see available commands.
        </div>
      </CenteredContent>
    );
  }

  return (
    <CenteredContent maxWidth="4xl" spacing="4" className="font-mono text-sm">
      {/* Header */}
      <div className="flex justify-between border-b border-border pb-2">
        <span className="font-bold">{page.name.toUpperCase()}</span>
        <span className="text-muted-foreground">Grimoire Manual</span>
        <span className="font-bold">{page.name.toUpperCase()}</span>
      </div>

      {/* NAME */}
      <section>
        <h2 className="font-bold mb-2">NAME</h2>
        <div className="ml-8">
          {page.name} - {page.description.split(".")[0]}
        </div>
      </section>

      {/* SYNOPSIS */}
      <section>
        <h2 className="font-bold mb-2">SYNOPSIS</h2>
        <div className="ml-8 text-accent">{page.synopsis}</div>
      </section>

      {/* DESCRIPTION */}
      <section>
        <h2 className="font-bold mb-2">DESCRIPTION</h2>
        <div className="ml-8 text-muted-foreground">{page.description}</div>
      </section>

      {/* OPTIONS */}
      {page.options && page.options.length > 0 && (
        <section>
          <h2 className="font-bold mb-2">OPTIONS</h2>
          <div className="ml-8 space-y-3">
            {page.options.map((opt, i) => (
              <div key={i}>
                <div className="text-accent font-semibold">{opt.flag}</div>
                <div className="ml-8 text-muted-foreground">
                  {opt.description}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* EXAMPLES */}
      {page.examples && page.examples.length > 0 && (
        <section>
          <h2 className="font-bold mb-2">EXAMPLES</h2>
          <div className="ml-8 space-y-3">
            {page.examples.map((example, i) => {
              // Split command from description
              // Pattern: command ends before first capital letter after flags
              const match = example.match(/^(.*?)(\s+[A-Z].*)$/);
              if (match) {
                const [, command, description] = match;
                return (
                  <div key={i}>
                    <ExecutableCommand commandLine={command.trim()}>
                      {command}
                    </ExecutableCommand>
                    <div className="ml-8 text-muted-foreground text-sm">
                      {description.trim()}
                    </div>
                  </div>
                );
              }
              // Fallback for examples without descriptions
              return (
                <div key={i}>
                  <ExecutableCommand commandLine={example.trim()}>
                    {example}
                  </ExecutableCommand>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* SEE ALSO */}
      {page.seeAlso && page.seeAlso.length > 0 && (
        <section>
          <h2 className="font-bold mb-2">SEE ALSO</h2>
          <div className="ml-8">
            {page.seeAlso.map((cmd, i) => (
              <span key={i}>
                <ExecutableCommand commandLine={`man ${cmd}`}>
                  <span className="text-accent">{cmd}</span>
                </ExecutableCommand>
                {i < page.seeAlso!.length - 1 && (
                  <span className="text-accent">, </span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}
    </CenteredContent>
  );
}
