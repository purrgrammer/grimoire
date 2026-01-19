import { Heart, MessageSquare, Quote } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export interface Testimonial {
  author: {
    name: string;
    npub?: string;
    avatar?: string;
  };
  content: string;
  type: "note" | "highlight";
  timestamp?: number;
}

interface TestimonialsSectionProps {
  testimonials?: Testimonial[];
}

// Placeholder testimonials - will be replaced with real Nostr events
const DEFAULT_TESTIMONIALS: Testimonial[] = [
  {
    author: {
      name: "fiatjaf",
      npub: "npub1...",
    },
    content:
      "Grimoire is exactly what Nostr needed - a powerful developer tool that makes exploring the protocol intuitive and fun.",
    type: "note",
  },
  {
    author: {
      name: "verbiricha",
      npub: "npub1...",
    },
    content:
      "The tiling window manager approach is genius. I can monitor multiple feeds, chat groups, and repositories all in one place.",
    type: "note",
  },
  {
    author: {
      name: "jack",
      npub: "npub1...",
    },
    content:
      "Finally, a Nostr client that feels like a native Unix environment. The command palette is incredibly powerful.",
    type: "highlight",
  },
];

export function TestimonialsSection({
  testimonials = DEFAULT_TESTIMONIALS,
}: TestimonialsSectionProps) {
  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Heart className="w-6 h-6 text-red-500" />
          <h2 className="text-2xl font-bold">What People Are Saying</h2>
        </div>
        <p className="text-muted-foreground">
          Testimonials from the Nostr community
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {testimonials.map((testimonial, index) => (
          <Card
            key={index}
            className="border-2 hover:border-primary/50 transition-colors"
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {testimonial.author.avatar ? (
                    <img
                      src={testimonial.author.avatar}
                      alt={testimonial.author.name}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-semibold">
                        {testimonial.author.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div>
                    <div className="font-semibold">
                      {testimonial.author.name}
                    </div>
                    {testimonial.author.npub && (
                      <div className="text-xs text-muted-foreground">
                        {testimonial.author.npub.slice(0, 12)}...
                      </div>
                    )}
                  </div>
                </div>
                {testimonial.type === "highlight" ? (
                  <Quote className="w-4 h-4 text-purple-500" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm leading-relaxed">
                {testimonial.content}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
