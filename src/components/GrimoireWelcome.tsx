import { Terminal, Github, MessageSquare, ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import { Kbd, KbdGroup } from "./ui/kbd";
import { SpellShowcase } from "./landing/SpellShowcase";
import { SpellbookShowcase } from "./landing/SpellbookShowcase";
import { TestimonialsSection } from "./landing/TestimonialsSection";
import { SupportSection } from "./landing/SupportSection";

interface GrimoireWelcomeProps {
  onLaunchCommand: () => void;
  onExecuteCommand: (command: string) => void;
}

export function GrimoireWelcome({ onLaunchCommand }: GrimoireWelcomeProps) {
  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="flex flex-col items-center gap-16 py-12 px-4">
        {/* Hero Section */}
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

          {/* Tagline */}
          <div className="text-center max-w-2xl space-y-4">
            <h2 className="text-xl md:text-2xl text-muted-foreground">
              A tiling window manager for the Nostr protocol
            </h2>
            <p className="text-sm text-muted-foreground/80">
              Explore feeds, profiles, and events with Unix-style commands.
              Craft powerful queries with spells. Save entire workspaces with
              spellbooks.
            </p>
          </div>

          {/* CTA Button */}
          <div className="flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm font-mono">
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
              <span> to get started</span>
            </p>
            <Button onClick={onLaunchCommand} size="lg" className="gap-2">
              <Terminal className="w-5 h-5" />
              <span>Launch Grimoire</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Divider */}
        <div className="w-full max-w-5xl border-t border-border" />

        {/* Spell Showcase */}
        <SpellShowcase />

        {/* Divider */}
        <div className="w-full max-w-5xl border-t border-border" />

        {/* Spellbook Showcase */}
        <SpellbookShowcase />

        {/* Divider */}
        <div className="w-full max-w-5xl border-t border-border" />

        {/* Testimonials */}
        <TestimonialsSection />

        {/* Divider */}
        <div className="w-full max-w-5xl border-t border-border" />

        {/* Support Section */}
        <SupportSection />

        {/* Footer */}
        <footer className="w-full max-w-5xl pt-8 pb-4 border-t border-border">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <a
                  href="https://github.com/hzrd149/grimoire"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-2"
                >
                  <Github className="w-4 h-4" />
                  <span>Source Code</span>
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a
                  href="nostr:chat/groups.0xchat.com'NkeVhXuWHGKKJCpn"
                  className="gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Community Chat</span>
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Built with ⚡ on Nostr
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
