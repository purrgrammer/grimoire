import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  WandSparkles,
  Plus,
  X,
  Clock,
  User,
  FileText,
  Search,
  Wifi,
  Tag,
  AtSign,
} from "lucide-react";
import { KindSelector } from "./KindSelector";
import { ProfileSelector } from "./ProfileSelector";
import { KindBadge } from "./KindBadge";
import { UserName } from "./nostr/UserName";
import { reconstructCommand } from "@/lib/spell-conversion";
import { SpellDialog } from "./nostr/SpellDialog";

interface CreateSpellDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * CreateSpellDialog - A newbie-friendly UI for building Nostr REQ commands
 * Allows users to visually construct filters without knowing the CLI syntax
 */
export function CreateSpellDialog({
  open,
  onOpenChange,
}: CreateSpellDialogProps) {
  // Filter state
  const [kinds, setKinds] = React.useState<number[]>([]);
  const [authors, setAuthors] = React.useState<string[]>([]);
  const [mentions, setMentions] = React.useState<string[]>([]);
  const [search, setSearch] = React.useState("");
  const [hashtags, setHashtags] = React.useState<string[]>([]);
  const [since, setSince] = React.useState<string>("");
  const [until, setUntil] = React.useState<string>("");
  const [relays, setRelays] = React.useState<string[]>([]);
  const [closeOnEose, setCloseOnEose] = React.useState(false);
  const [limit, setLimit] = React.useState<number | "">("");
  const [genericTags, setGenericTags] = React.useState<
    Record<string, string[]>
  >({});
  const [activeTagLetter, setActiveTagLetter] = React.useState("e");

  // Sub-dialog state
  const [showSaveDialog, setShowSaveDialog] = React.useState(false);

  // Reconstruct command string for preview and saving
  const generatedCommand = React.useMemo(() => {
    const filter: any = {
      kinds: kinds.length > 0 ? kinds : undefined,
      authors: authors.length > 0 ? authors : undefined,
      "#p": mentions.length > 0 ? mentions : undefined,
      "#t": hashtags.length > 0 ? hashtags : undefined,
      search: search || undefined,
      limit: limit !== "" ? limit : undefined,
    };

    // Add generic tags
    for (const [letter, values] of Object.entries(genericTags)) {
      if (values.length > 0) {
        filter[`#${letter}`] = values;
      }
    }

    return reconstructCommand(
      filter,
      relays.length > 0 ? relays : undefined,
      since || undefined,
      until || undefined,
      closeOnEose,
    );
  }, [
    kinds,
    authors,
    mentions,
    search,
    hashtags,
    since,
    until,
    relays,
    closeOnEose,
    limit,
    genericTags,
  ]);

  const handleAddKind = (kind: number) => {
    if (!kinds.includes(kind)) setKinds([...kinds, kind]);
  };

  const handleRemoveKind = (kind: number) => {
    setKinds(kinds.filter((k) => k !== kind));
  };

  const handleAddAuthor = (pubkey: string) => {
    if (!authors.includes(pubkey)) setAuthors([...authors, pubkey]);
  };

  const handleRemoveAuthor = (pubkey: string) => {
    setAuthors(authors.filter((p) => p !== pubkey));
  };

  const handleAddMention = (pubkey: string) => {
    if (!mentions.includes(pubkey)) setMentions([...mentions, pubkey]);
  };

  const handleRemoveMention = (pubkey: string) => {
    setMentions(mentions.filter((p) => p !== pubkey));
  };

  const handleAddHashtag = (tag: string) => {
    const clean = tag.replace(/^#/, "").trim();
    if (clean && !hashtags.includes(clean)) setHashtags([...hashtags, clean]);
  };

  const handleRemoveHashtag = (tag: string) => {
    setHashtags(hashtags.filter((t) => t !== tag));
  };

  const handleAddRelay = (url: string) => {
    if (url && !relays.includes(url)) setRelays([...relays, url]);
  };

  const handleRemoveRelay = (url: string) => {
    setRelays(relays.filter((r) => r !== url));
  };

  const handleAddGenericTag = (letter: string, value: string) => {
    if (!letter || !value) return;
    const cleanLetter = letter.trim().slice(0, 1);
    if (!/[a-zA-Z]/.test(cleanLetter)) return;

    setGenericTags((prev) => {
      const existing = prev[cleanLetter] || [];
      if (existing.includes(value)) return prev;
      return {
        ...prev,
        [cleanLetter]: [...existing, value],
      };
    });
  };

  const handleRemoveGenericTag = (letter: string, value: string) => {
    setGenericTags((prev) => {
      const existing = prev[letter] || [];
      const filtered = existing.filter((v) => v !== value);
      if (filtered.length === 0) {
        const { [letter]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [letter]: filtered,
      };
    });
  };

  const resetForm = () => {
    setKinds([]);
    setAuthors([]);
    setMentions([]);
    setSearch("");
    setHashtags([]);
    setSince("");
    setUntil("");
    setRelays([]);
    setCloseOnEose(false);
    setLimit("");
    setGenericTags({});
    setActiveTagLetter("e");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <WandSparkles className="size-5 text-accent" />
              Create New Spell
            </DialogTitle>
            <DialogDescription>
              Build a custom view of Nostr events by selecting filters below.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            {/* Kinds Section */}
            <CollapsibleSection
              title="Event Types"
              icon={<FileText className="size-4" />}
              defaultOpen={true}
            >
              <div className="space-y-3">
                <KindSelector onSelect={handleAddKind} />
                <div className="flex flex-wrap gap-2">
                  {kinds.map((k) => (
                    <Badge
                      key={k}
                      variant="secondary"
                      className="flex items-center gap-1.5"
                    >
                      <KindBadge
                        kind={k}
                        className="border-0 bg-transparent p-0 h-auto"
                      />
                      <button
                        onClick={() => handleRemoveKind(k)}
                        className="hover:text-accent transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  {kinds.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      All event types (notes, profiles, etc.)
                    </span>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            {/* Authors Section */}
            <CollapsibleSection
              title="From People"
              icon={<User className="size-4" />}
            >
              <div className="space-y-3">
                <ProfileSelector
                  onSelect={handleAddAuthor}
                  placeholder="Add person or $me, $contacts..."
                />
                <div className="flex flex-wrap gap-2">
                  {authors.map((p) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="flex items-center gap-1.5"
                    >
                      {p === "$me" || p === "$contacts" ? (
                        <span className="font-mono font-bold text-accent px-1">
                          {p}
                        </span>
                      ) : (
                        <UserName pubkey={p} className="text-xs" />
                      )}
                      <button
                        onClick={() => handleRemoveAuthor(p)}
                        className="hover:text-accent transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  {authors.length === 0 && (
                    <span className="text-xs text-muted-foreground italic">
                      Anyone on the network
                    </span>
                  )}
                </div>
              </div>
            </CollapsibleSection>

            {/* Mentions Section */}
            <CollapsibleSection
              title="Mentioning People"
              icon={<AtSign className="size-4" />}
            >
              <div className="space-y-3">
                <ProfileSelector
                  onSelect={handleAddMention}
                  placeholder="Add person mentioned..."
                />
                <div className="flex flex-wrap gap-2">
                  {mentions.map((p) => (
                    <Badge
                      key={p}
                      variant="secondary"
                      className="flex items-center gap-1.5"
                    >
                      {p === "$me" || p === "$contacts" ? (
                        <span className="font-mono font-bold text-accent px-1">
                          {p}
                        </span>
                      ) : (
                        <UserName pubkey={p} className="text-xs" />
                      )}
                      <button
                        onClick={() => handleRemoveMention(p)}
                        className="hover:text-accent transition-colors"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            </CollapsibleSection>

            {/* Content Section */}
            <CollapsibleSection
              title="Content & Hashtags"
              icon={<Search className="size-4" />}
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Search Text
                  </label>
                  <Input
                    placeholder="e.g. bitcoin, nostr..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Hashtags
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add tag (press enter)"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddHashtag(e.currentTarget.value);
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {hashtags.map((t) => (
                      <Badge
                        key={t}
                        variant="secondary"
                        className="flex items-center gap-1.5"
                      >
                        <span className="text-accent">#</span>
                        {t}
                        <button
                          onClick={() => handleRemoveHashtag(t)}
                          className="hover:text-accent transition-colors"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            {/* Generic Tags Section */}
            <CollapsibleSection
              title="Generic Tags"
              icon={<Tag className="size-4" />}
            >
              <div className="space-y-4">
                <div className="flex gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">
                      Letter
                    </label>
                    <Input
                      value={activeTagLetter}
                      onChange={(e) =>
                        setActiveTagLetter(e.target.value.trim().slice(0, 1))
                      }
                      className="w-12 text-center font-mono font-bold"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground">
                      Value
                    </label>
                    {activeTagLetter === "k" ? (
                      <KindSelector
                        onSelect={(k) => handleAddGenericTag("k", k.toString())}
                      />
                    ) : activeTagLetter === "p" || activeTagLetter === "P" ? (
                      <ProfileSelector
                        onSelect={(pk) =>
                          handleAddGenericTag(activeTagLetter, pk)
                        }
                        placeholder={`Add ${activeTagLetter} pubkey...`}
                      />
                    ) : (
                      <Input
                        placeholder="Tag value..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddGenericTag(
                              activeTagLetter,
                              e.currentTarget.value,
                            );
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {Object.entries(genericTags).map(([letter, values]) => (
                    <div key={letter} className="space-y-1">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground">
                        #{letter}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {values.map((val) => (
                          <Badge
                            key={val}
                            variant="secondary"
                            className="flex items-center gap-1.5"
                          >
                            {letter === "k" ? (
                              <KindBadge
                                kind={parseInt(val)}
                                className="border-0 bg-transparent p-0 h-auto"
                              />
                            ) : letter === "p" || letter === "P" ? (
                              val.startsWith("$") ? (
                                <span className="font-mono font-bold text-accent px-1">
                                  {val}
                                </span>
                              ) : (
                                <UserName pubkey={val} className="text-xs" />
                              )
                            ) : (
                              <span
                                className="max-w-[200px] truncate"
                                title={val}
                              >
                                {val}
                              </span>
                            )}
                            <button
                              onClick={() =>
                                handleRemoveGenericTag(letter, val)
                              }
                              className="hover:text-accent transition-colors"
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleSection>

            {/* Time Section */}
            <CollapsibleSection
              title="Time Range"
              icon={<Clock className="size-4" />}
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Since
                  </label>
                  <Input
                    placeholder="e.g. 24h, 7d, 1mo"
                    value={since}
                    onChange={(e) => setSince(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1">
                    {["now", "1h", "24h", "7d", "30d"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setSince(t)}
                        className="text-[10px] bg-muted px-1.5 py-0.5 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Until
                  </label>
                  <Input
                    placeholder="e.g. now, 24h"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1">
                    {["now", "1h", "24h", "7d", "30d"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setUntil(t)}
                        className="text-[10px] bg-muted px-1.5 py-0.5 rounded hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            {/* Options Section */}
            <CollapsibleSection
              title="Advanced Options"
              icon={<Wifi className="size-4" />}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Limit results</label>
                  <Input
                    type="number"
                    value={limit}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLimit(val === "" ? "" : parseInt(val));
                    }}
                    placeholder="No limit"
                    className="w-24"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium">
                      Close after loading
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Don't listen for new events in real-time
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={closeOnEose}
                    onChange={(e) => setCloseOnEose(e.target.checked)}
                    className="size-4 rounded border-gray-300 text-accent focus:ring-accent"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase text-muted-foreground">
                    Custom Relays (optional)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="relay.damus.io"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleAddRelay(e.currentTarget.value);
                          e.currentTarget.value = "";
                        }
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {relays.map((r) => (
                      <Badge
                        key={r}
                        variant="outline"
                        className="flex items-center gap-1.5 font-mono text-[10px]"
                      >
                        {r}
                        <button
                          onClick={() => handleRemoveRelay(r)}
                          className="hover:text-accent transition-colors"
                        >
                          <X className="size-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleSection>
          </div>

          <div className="p-6 pt-2 bg-muted/30 border-t space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                Generated Command
              </label>
              <div className="bg-background border rounded-md p-3 font-mono text-xs break-words overflow-x-auto text-primary">
                {generatedCommand}
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={resetForm}>
                Reset
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                className="bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => setShowSaveDialog(true)}
              >
                <Plus className="size-4 mr-2" />
                Continue to Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Actual saving/publishing dialog */}
      {showSaveDialog && (
        <SpellDialog
          open={showSaveDialog}
          onOpenChange={setShowSaveDialog}
          mode="create"
          initialCommand={generatedCommand}
          onSuccess={() => {
            setShowSaveDialog(false);
            onOpenChange(false);
            resetForm();
          }}
        />
      )}
    </>
  );
}

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="border rounded-lg overflow-hidden"
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 bg-muted/50 hover:bg-muted transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-accent">{icon}</span>
          <span className="font-semibold text-sm">{title}</span>
        </div>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="p-4 bg-background">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "default" | "secondary" | "outline";
  className?: string;
}) {
  const variants = {
    default: "bg-primary text-primary-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    outline: "border border-input bg-background",
  };

  return (
    <div
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${variants[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
