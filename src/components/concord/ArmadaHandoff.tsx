/**
 * The two places grimoire has to say "this part happens in Armada".
 *
 * Grimoire reads Concord; it does not join, invite, moderate or rotate. So both
 * of these are an EXPLANATION and a link, never an in-app action — the handoff
 * is honest about where the missing capability lives rather than pretending to
 * offer it.
 */

import { RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ExternalLink";
import { ARMADA_URL } from "@/constants/concord-links";

export { ARMADA_URL };

/**
 * There is no community list to read, because nothing has published one yet.
 *
 * Says the actual mechanism rather than "nothing found": the list is a kind
 * 13302 encrypted to yourself, Armada is what writes it, and it is the SAME key
 * on both sides that makes it appear here.
 */
export function NoCommunitiesEmpty({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-3 text-sm text-muted-foreground">
        <p>
          No Concord communities yet. Create or join one in Armada with the same
          Nostr key you are signed in with here — it publishes the encrypted
          membership list this window reads, and grimoire never writes it.
        </p>
        <div className="flex items-center justify-center gap-3">
          <ExternalLink href={ARMADA_URL} size="sm">
            Open Armada
          </ExternalLink>
          {onRefresh && (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="size-3" />
              Check again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * You joined with an invite the community had already rotated past.
 *
 * A banner rather than a blocked pane: a stranded member can still read every
 * message written before the rotation, and taking that away would punish them
 * for the invite being stale. The explanation used to live in a `title`
 * attribute on a 10px pill, which is to say nowhere.
 */
export function StrandedBanner() {
  return (
    <div className="flex items-start gap-2 border-b border-dotted bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <p>
        The invite you joined with was out of date: this community rotated its
        keys past the epoch you hold, and the rotation happened before you
        joined, so it carries nothing for you. History from before the rotation
        still reads. Invites are created in Armada — ask a member for a fresh
        link or a direct invite.{" "}
        <ExternalLink href={ARMADA_URL} size="xs">
          Open Armada
        </ExternalLink>
      </p>
    </div>
  );
}
