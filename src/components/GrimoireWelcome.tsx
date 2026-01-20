import { Terminal } from "lucide-react";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { Progress } from "./ui/progress";
import { MONTHLY_GOAL_SATS } from "@/services/supporters";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";

interface GrimoireWelcomeProps {
  onLaunchCommand: () => void;
  onExecuteCommand: (command: string) => void;
}

const EXAMPLE_COMMANDS = [
  {
    command: "zap grimoire.rocks",
    description: "Support Grimoire development",
    showProgress: true,
  },
  {
    command: "chat groups.0xchat.com'NkeVhXuWHGKKJCpn",
    description: "Join the Grimoire welcome chat",
  },
  {
    command: "profile fiatjaf.com",
    description: "Explore a Nostr profile",
  },
  { command: "req -k 1 -l 20", description: "Query recent notes" },
];

export function GrimoireWelcome({
  onLaunchCommand,
  onExecuteCommand,
}: GrimoireWelcomeProps) {
  // Calculate monthly donations reactively from DB (last 30 days)
  const monthlyDonations =
    useLiveQuery(async () => {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      let total = 0;
      await db.grimoireZaps
        .where("timestamp")
        .aboveOrEqual(thirtyDaysAgo)
        .each((zap) => {
          total += zap.amountSats;
        });
      return total;
    }, []) ?? 0;

  // Calculate progress
  const goalProgress = (monthlyDonations / MONTHLY_GOAL_SATS) * 100;

  // Format sats
  function formatSats(sats: number): string {
    if (sats >= 1_000_000) {
      return `${(sats / 1_000_000).toFixed(1)}M`;
    } else if (sats >= 1_000) {
      return `${Math.floor(sats / 1_000)}k`;
    }
    return sats.toString();
  }

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-8">
        {/* Desktop: ASCII art */}
        <div className="hidden md:block">
          <pre className="font-mono text-xs leading-tight text-grimoire-gradient">
            {`                    ★                                             ✦
                                                       :          ☽
                                                      t#,                           ,;
    ✦     .Gt j.         t                           ;##W.   t   j.               f#i
         j#W: EW,        Ej            ..       :   :#L:WE   Ej  EW,            .E#t
   ☆   ;K#f   E##j       E#,          ,W,     .Et  .KG  ,#D  E#, E##j          i#W,
     .G#D.    E###D.     E#t         t##,    ,W#t  EE    ;#f E#t E###D.       L#D.  ✦
    j#K;      E#jG#W;    E#t        L###,   j###t f#.     t#iE#t E#jG#W;    :K#Wfff;
  ,K#f   ,GD; E#t t##f   E#t      .E#j##,  G#fE#t :#G     GK E#t E#t t##f   i##WLLLLt
☽  j#Wi   E#t E#t  :K#E: E#t     ;WW; ##,:K#i E#t  ;#L   LW. E#t E#t  :K#E:  .E#L
    .G#D: E#t E#KDDDD###iE#t    j#E.  ##f#W,  E#t   t#f f#:  E#t E#KDDDD###i   f#E: ★
      ,K#fK#t E#f,t#Wi,,,E#t  .D#L    ###K:   E#t    f#D#;   E#t E#f,t#Wi,,,    ,WW;
   ✦    j###t E#t  ;#W:  E#t :K#t     ##D.    E#t     G#t    E#t E#t  ;#W:       .D#;
         .G#t DWi   ,KK: E#t ...      #G      ..       t     E#t DWi   ,KK:        tt
           ;;      ☆     ,;.          j              ✦       ,;.                ☆     `}
          </pre>
          <p className="text-center text-muted-foreground text-sm font-mono mt-4">
            a nostr client for magicians
          </p>
        </div>

        {/* Mobile: Simple text */}
        <div className="md:hidden text-center">
          <h1 className="text-4xl font-bold text-grimoire-gradient mb-2">
            grimoire
          </h1>
          <p className="text-muted-foreground text-sm font-mono">
            a nostr client for magicians
          </p>
        </div>

        {/* Launch button */}
        <div className="flex flex-col items-center gap-3">
          <p className="text-muted-foreground text-sm font-mono mb-2">
            <span>Press </span>
            <KbdGroup>
              <Kbd>Cmd</Kbd>
              <span>+</span>
              <Kbd>K</Kbd>
            </KbdGroup>
            <span> or </span>
            <KbdGroup>
              <Kbd>Ctrl</Kbd>
              <span>+</span>
              <Kbd>K</Kbd>
            </KbdGroup>
          </p>
          <Button onClick={onLaunchCommand} variant="outline">
            <Terminal />
            <span>Launch Command</span>
          </Button>
        </div>

        {/* Example commands */}
        <div className="flex flex-col items-start gap-2 w-full max-w-md">
          <p className="text-muted-foreground text-xs font-mono mb-1">
            Try these commands:
          </p>
          {EXAMPLE_COMMANDS.map(({ command, description, showProgress }) => (
            <button
              key={command}
              onClick={() => onExecuteCommand(command)}
              className="w-full text-left px-3 py-2 rounded-md border border-border hover:border-accent hover:bg-accent/5 transition-colors group"
            >
              <div className="font-mono text-sm text-foreground group-hover:text-accent transition-colors">
                {command}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {description}
              </div>
              {showProgress && (
                <div className="mt-2 flex flex-col gap-1">
                  <Progress value={goalProgress} className="h-1" />
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">
                      <span className="text-foreground font-medium">
                        {formatSats(monthlyDonations)}
                      </span>
                      {" / "}
                      {formatSats(MONTHLY_GOAL_SATS)}
                    </span>
                    <span className="text-muted-foreground">
                      {goalProgress.toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
