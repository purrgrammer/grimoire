import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { decodeSpell } from "@/lib/spell-conversion";
import { ExecutableCommand } from "../../ManPage";
import { Badge } from "@/components/ui/badge";
import { KindBadge } from "@/components/KindBadge";
import { SpellEvent } from "@/types/spell";
import { CopyableJsonViewer } from "@/components/JsonViewer";
import { User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserName } from "../UserName";
import { useGrimoire } from "@/core/state";
import { useProfile } from "@/hooks/useProfile";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { getDisplayName } from "@/lib/nostr-utils";

/**
 * Visual placeholder for $me
 */
export function MePlaceholder({
  size = "sm",
  className,
  pubkey,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  pubkey?: string;
}) {
  const { addWindow } = useGrimoire();
  const profile = useProfile(pubkey);
  const displayName = pubkey ? getDisplayName(pubkey, profile) : "$me";

  const handleClick = (e: React.MouseEvent) => {
    if (!pubkey) return;
    e.stopPropagation();
    addWindow("profile", { pubkey });
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-bold text-orange-400 select-none",
        pubkey && "cursor-crosshair hover:underline decoration-dotted",
        size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-lg",
        className,
      )}
      onClick={handleClick}
    >
      <User className={cn(size === "sm" ? "size-3" : "size-4")} />
      {displayName}
    </span>
  );
}

/**
 * Visual placeholder for $contacts
 */
export function ContactsPlaceholder({
  size = "sm",
  className,
  pubkey,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
  pubkey?: string;
}) {
  const { addWindow } = useGrimoire();
  const contactList = useNostrEvent(
    pubkey
      ? {
          kind: 3,
          pubkey,
          identifier: "",
        }
      : undefined,
  );

  const count = contactList?.tags.filter((t) => t[0] === "p").length;
  const label = count !== undefined ? `${count} contacts` : "$contacts";

  const handleClick = (e: React.MouseEvent) => {
    if (!pubkey) return;
    e.stopPropagation();
    addWindow("open", {
      pointer: {
        kind: 3,
        pubkey,
        identifier: "",
      },
    });
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-bold text-accent select-none",
        pubkey && "cursor-crosshair hover:underline decoration-dotted",
        size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-lg",
        className,
      )}
      onClick={handleClick}
    >
      <Users className={cn(size === "sm" ? "size-3" : "size-4")} />
      {label}
    </span>
  );
}

/**
 * Renderer for a list of identifiers (pubkeys or placeholders)
 */
function IdentifierList({
  values,
  size = "md",
  activePubkey,
}: {
  values: string[];
  size?: "sm" | "md" | "lg";
  activePubkey?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {values.map((val) => {
        if (val === "$me")
          return <MePlaceholder key={val} size={size} pubkey={activePubkey} />;
        if (val === "$contacts")
          return (
            <ContactsPlaceholder key={val} size={size} pubkey={activePubkey} />
          );
        return (
          <UserName
            key={val}
            pubkey={val}
            className={cn(
              size === "sm" ? "text-xs" : size === "md" ? "text-sm" : "text-lg",
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * Renderer for Kind 777 - Spell (REQ Command)
 * Displays spell name, description, and the reconstructed command
 */
export function SpellRenderer({ event }: BaseEventProps) {
  try {
    const spell = decodeSpell(event as SpellEvent);

    return (
      <BaseEventContainer event={event}>
        <div className="flex flex-col gap-2">
          {/* Title */}
          {spell.name && (
            <ClickableEventTitle
              event={event}
              className="text-lg font-semibold text-foreground"
            >
              {spell.name}
            </ClickableEventTitle>
          )}

          {/* Description */}
          {spell.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {spell.description}
            </p>
          )}

          {/* Command Preview */}
          <ExecutableCommand
            commandLine={spell.command}
            className="text-xs font-mono bg-muted/30 p-2 border border-border truncate line-clamp-1 text-primary hover:underline cursor-pointer"
          >
            {spell.command}
          </ExecutableCommand>

          {/* Kind Badges */}
          {spell.filter.kinds && spell.filter.kinds.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {spell.filter.kinds.map((kind) => (
                <KindBadge
                  key={kind}
                  kind={kind}
                  className="text-[10px]"
                  showName
                  clickable
                />
              ))}
            </div>
          )}
        </div>
      </BaseEventContainer>
    );
  } catch (error) {
    return (
      <BaseEventContainer event={event}>
        <div className="text-destructive text-sm p-2 border border-destructive/20 bg-destructive/10">
          Failed to decode spell:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </BaseEventContainer>
    );
  }
}

/**
 * Detail renderer for Kind 777 - Spell
 * Shows more information about the spell and its filter
 */
export function SpellDetailRenderer({ event }: BaseEventProps) {
  const { state } = useGrimoire();
  const activePubkey = state.activeAccount?.pubkey;

  try {
    const spell = decodeSpell(event as SpellEvent);

    // Create a display filter that includes since/until even in relative format
    const displayFilter = { ...spell.filter };

    // Extract raw since/until values from tags
    const sinceTag = event.tags.find((t) => t[0] === "since")?.[1];
    const untilTag = event.tags.find((t) => t[0] === "until")?.[1];

    if (sinceTag && !displayFilter.since) {
      displayFilter.since = sinceTag as any; // Show relative format like "7d"
    }
    if (untilTag && !displayFilter.until) {
      displayFilter.until = untilTag as any; // Show relative format like "now"
    }

    return (
      <div className="flex flex-col gap-6 p-4">
        <div className="flex flex-col gap-2">
          {spell.name && (
            <ClickableEventTitle
              event={event}
              className="text-2xl font-bold hover:underline cursor-pointer"
            >
              {spell.name}
            </ClickableEventTitle>
          )}
          {spell.description && (
            <p className="text-muted-foreground">{spell.description}</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Command
          </h3>
          <ExecutableCommand
            commandLine={spell.command}
            className="text-sm font-mono p-4 bg-muted/30 border border-border text-primary hover:underline hover:decoration-dotted cursor-crosshair break-words overflow-x-auto"
          >
            {spell.command}
          </ExecutableCommand>
        </div>

        {spell.filter.kinds && spell.filter.kinds.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Kinds
            </h3>
            <div className="flex flex-wrap gap-4">
              {spell.filter.kinds.map((kind) => (
                <KindBadge key={kind} kind={kind} clickable />
              ))}
            </div>
          </div>
        )}

        {spell.filter.authors && spell.filter.authors.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Authors
            </h3>
            <IdentifierList
              values={spell.filter.authors}
              size="md"
              activePubkey={activePubkey}
            />
          </div>
        )}

        {spell.filter["#p"] && spell.filter["#p"].length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Mentions
            </h3>
            <IdentifierList
              values={spell.filter["#p"]}
              size="md"
              activePubkey={activePubkey}
            />
          </div>
        )}

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Filter
          </h3>
          <CopyableJsonViewer json={JSON.stringify(displayFilter, null, 2)} />
        </div>

        {spell.relays && spell.relays.length > 0 && (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Target Relays
            </h3>
            <div className="flex flex-wrap gap-2">
              {spell.relays.map((relay) => (
                <Badge key={relay} variant="secondary" className="font-mono">
                  {relay}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  } catch (error) {
    return (
      <div className="p-4">
        <div className="text-destructive p-4 border border-destructive/20 bg-destructive/10 rounded">
          Failed to decode spell:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    );
  }
}
