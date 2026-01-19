import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface FeaturedSpell {
  title: string;
  description: string;
  command: string;
  preview: {
    type: "feed" | "profile" | "stats";
    content: string;
  };
}

const FEATURED_SPELLS: FeaturedSpell[] = [
  {
    title: "Global Feed",
    description: "See what's happening on Nostr right now",
    command: "req -k 1 -l 20",
    preview: {
      type: "feed",
      content: "Live stream of recent notes from across the Nostr network",
    },
  },
  {
    title: "Bitcoin News",
    description: "Follow the latest Bitcoin discussions",
    command: "req -k 1 -#t bitcoin -l 30",
    preview: {
      type: "feed",
      content: "Curated feed of Bitcoin-related content",
    },
  },
  {
    title: "Long-form Articles",
    description: "Deep dives and thought pieces",
    command: "req -k 30023 -l 10",
    preview: {
      type: "feed",
      content: "Discover in-depth articles from Nostr writers",
    },
  },
  {
    title: "Developer Activity",
    description: "Track Nostr development and git repos",
    command: "req -k 30617 -l 15",
    preview: {
      type: "feed",
      content: "Monitor repository announcements and code updates",
    },
  },
  {
    title: "Network Stats",
    description: "Count events across relays",
    command: "count -k 1,6,7",
    preview: {
      type: "stats",
      content: "Aggregate event counts for network insights",
    },
  },
];

export function SpellShowcase() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="w-6 h-6 text-yellow-500" />
          <h2 className="text-2xl font-bold">Featured Spells</h2>
        </div>
        <p className="text-muted-foreground">
          Powerful queries to explore the Nostr network
        </p>
      </div>

      <div className="relative">
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex">
            {FEATURED_SPELLS.map((spell, index) => (
              <div key={index} className="flex-[0_0_100%] min-w-0 px-2">
                <Card className="border-2 hover:border-primary transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{spell.title}</span>
                      <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">
                        {spell.command}
                      </span>
                    </CardTitle>
                    <CardDescription>{spell.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted/50 rounded-lg p-4 min-h-[120px] border border-border">
                      <div className="flex items-start gap-2">
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                          {spell.preview.type}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground italic">
                        {spell.preview.content}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>

        <Button
          variant="outline"
          size="icon"
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full shadow-lg"
          onClick={scrollPrev}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rounded-full shadow-lg"
          onClick={scrollNext}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex justify-center gap-2">
        {FEATURED_SPELLS.map((_, index) => (
          <button
            key={index}
            className={`w-2 h-2 rounded-full transition-all ${
              index === selectedIndex
                ? "bg-primary w-8"
                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            onClick={() => emblaApi?.scrollTo(index)}
          />
        ))}
      </div>
    </div>
  );
}
