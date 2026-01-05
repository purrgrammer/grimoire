import { cn } from "@/lib/utils";
import pool from "@/services/relay-pool";
import { use$ } from "applesauce-react/hooks";
import { Relay } from "applesauce-relay";
import { Server, ServerOff } from "lucide-react";

function RelayItem({ relay }: { relay: Relay }) {
  const icon = "size-4";
  return (
    <div className="flex flex-row items-center gap-1">
      {relay.connected ? (
        <Server className={cn(icon, "text-green-300")} />
      ) : (
        <ServerOff className={cn(icon, "text-destructive-foreground")} />
      )}
      <span className="text-xs">{relay.url}</span>
    </div>
  );
}

export default function RelayPool() {
  const relays = use$(pool.relays$);
  return (
    <div className="flex flex-col gap-1">
      {Array.from(relays.entries()).map(([url, relay]) => (
        <RelayItem key={url} relay={relay} />
      ))}
    </div>
  );
}
