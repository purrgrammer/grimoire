import { Button } from "./ui/button";

interface GrimoireWelcomeProps {
  onLaunchCommand: () => void;
}

export function GrimoireWelcome({ onLaunchCommand }: GrimoireWelcomeProps) {
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
            Press{" "}
            <kbd className="px-2 py-1 bg-muted border border-border text-xs">
              Cmd+K
            </kbd>{" "}
            or
          </p>
          <Button onClick={onLaunchCommand} variant="outline">
            <span>⌘</span>
            <span>Launch Command</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
