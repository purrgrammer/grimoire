import { useState } from "react";
import { Bitcoin } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The mempool.space mark, for a link to a Bitcoin transaction.
 *
 * Vendored under `public/` rather than hotlinked: a mark that only renders
 * when someone else's CDN is reachable is not much of a mark. It also matters
 * more here than for an avatar would — loading
 * it from mempool.space would tell them, on render and without the reader
 * doing anything, that this person is looking at a page about a transaction.
 * Following the link says that deliberately; the icon should not say it first.
 */
export function MempoolIcon({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <Bitcoin className={cn("size-3.5 shrink-0", className)} />;
  }

  return (
    <img
      alt="mempool.space"
      className={cn("size-3.5 shrink-0 select-none", className)}
      height={14}
      onError={() => setFailed(true)}
      src="/mempool-space.png"
      width={14}
    />
  );
}
