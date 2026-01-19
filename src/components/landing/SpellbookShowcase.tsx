import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { BookOpen, ChevronLeft, ChevronRight, Layout } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface FeaturedSpellbook {
  title: string;
  description: string;
  author: string;
  windows: string[];
  useCase: string;
}

const FEATURED_SPELLBOOKS: FeaturedSpellbook[] = [
  {
    title: "Developer Dashboard",
    description: "Complete setup for Nostr development and monitoring",
    author: "fiatjaf",
    windows: [
      "NIP Documentation",
      "Git Repositories Feed",
      "Developer Chat",
      "Network Stats",
    ],
    useCase: "Track PRs, NIPs, and coordinate with other devs",
  },
  {
    title: "Bitcoin Research Hub",
    description: "Follow Bitcoin news, analysis, and market sentiment",
    author: "verbiricha",
    windows: ["Bitcoin Feed", "Price Tracker", "Long-form Articles", "Charts"],
    useCase: "Stay informed on Bitcoin ecosystem developments",
  },
  {
    title: "Content Creator Studio",
    description: "Manage your Nostr presence and engage with followers",
    author: "jack",
    windows: [
      "Your Profile",
      "Notifications",
      "Mentions Feed",
      "Scheduled Posts",
    ],
    useCase: "Create, publish, and monitor engagement",
  },
  {
    title: "Community Manager",
    description: "Moderate and engage with multiple Nostr groups",
    author: "verbiricha",
    windows: [
      "Group Chat 1",
      "Group Chat 2",
      "Moderation Queue",
      "Member Directory",
    ],
    useCase: "Coordinate communities and handle moderation",
  },
];

export function SpellbookShowcase() {
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
          <BookOpen className="w-6 h-6 text-purple-500" />
          <h2 className="text-2xl font-bold">Featured Spellbooks</h2>
        </div>
        <p className="text-muted-foreground">
          Complete workspace configurations for every use case
        </p>
      </div>

      <div className="relative">
        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex">
            {FEATURED_SPELLBOOKS.map((spellbook, index) => (
              <div key={index} className="flex-[0_0_100%] min-w-0 px-2">
                <Card className="border-2 hover:border-primary transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>{spellbook.title}</span>
                      <span className="text-xs text-muted-foreground">
                        by @{spellbook.author}
                      </span>
                    </CardTitle>
                    <CardDescription>{spellbook.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="bg-muted/50 rounded-lg p-4 border border-border">
                      <div className="flex items-center gap-2 mb-3">
                        <Layout className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          Layout Preview
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {spellbook.windows.map((window, i) => (
                          <div
                            key={i}
                            className="bg-background rounded p-2 text-xs text-center border border-border"
                          >
                            {window}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-semibold">Use case:</span>{" "}
                      {spellbook.useCase}
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
        {FEATURED_SPELLBOOKS.map((_, index) => (
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
