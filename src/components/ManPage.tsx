import { manPages } from "@/types/man";
import { useGrimoire } from "@/core/state";

interface ManPageProps {
  cmd: string;
}

/**
 * ExecutableCommand - Renders a clickable command that executes when clicked
 */
function ExecutableCommand({
  commandLine,
  children,
}: {
  commandLine: string;
  children: React.ReactNode;
}) {
  const { addWindow } = useGrimoire();

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

      addWindow(command.appId, cmdProps);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="text-accent font-medium hover:underline cursor-crosshair text-left"
    >
      {children}
    </button>
  );
}

export default function ManPage({ cmd }: ManPageProps) {
  const page = manPages[cmd];

  if (!page) {
    return (
      <div className="p-6 font-mono text-sm">
        <div className="text-destructive">No manual entry for {cmd}</div>
        <div className="mt-4 text-muted-foreground">
          Use 'help' to see available commands.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 font-mono text-sm space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex justify-between border-b border-border pb-2">
        <span className="font-bold">
          {page.name.toUpperCase()}
        </span>
        <span className="text-muted-foreground">Grimoire Manual</span>
        <span className="font-bold">
          {page.name.toUpperCase()}
        </span>
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
                <div className="text-accent font-semibold">
                  {opt.flag}
                </div>
                <div className="ml-8 text-muted-foreground">{opt.description}</div>
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

      {/* Footer */}
      <div className="border-t border-border pt-2 text-muted-foreground text-xs">
        Grimoire 1.0.0 {new Date().getFullYear()}
      </div>
    </div>
  );
}
