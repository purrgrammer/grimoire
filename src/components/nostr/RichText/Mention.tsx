import { kinds } from "nostr-tools";
import { UserName } from "../UserName";
import { EventEmbed } from "./EventEmbed";
import { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { useDepth, useRichTextOptions } from "../RichText";

interface MentionNodeProps {
  node: {
    decoded?: {
      type?: string;
      data?: any;
    };
    encoded?: string;
  };
}

export function Mention({ node }: MentionNodeProps) {
  const depth = useDepth();
  const options = useRichTextOptions();

  if (node.decoded?.type === "npub") {
    const pubkey = node.decoded.data;
    return (
      <UserName
        isMention
        pubkey={pubkey}
        className="text-muted-foreground hover:text-primary"
      />
    );
  }

  if (node.decoded?.type === "nprofile") {
    const pubkey = node.decoded.data.pubkey;
    return (
      <UserName
        isMention
        pubkey={pubkey}
        className="text-muted-foreground hover:text-primary"
      />
    );
  }

  if (node.decoded?.type === "note") {
    // note is just an event ID, create a simple EventPointer
    const pointer: EventPointer = {
      id: node.decoded.data,
      kind: kinds.ShortTextNote,
      relays: [],
    };

    if (!options.showEventEmbeds) {
      return (
        <span className="text-muted-foreground font-mono text-sm">
          {node.encoded || `note:${pointer.id.slice(0, 8)}...`}
        </span>
      );
    }

    return <EventEmbed node={{ pointer }} depth={depth} />;
  }

  if (node.decoded?.type === "nevent") {
    const pointer: EventPointer = node.decoded.data;

    if (!options.showEventEmbeds) {
      return (
        <span className="text-muted-foreground font-mono text-sm">
          {node.encoded || `nevent:${pointer.id.slice(0, 8)}...`}
        </span>
      );
    }

    return <EventEmbed node={{ pointer }} depth={depth} />;
  }

  if (node.decoded?.type === "naddr") {
    const pointer: AddressPointer = node.decoded.data;

    if (!options.showEventEmbeds) {
      return (
        <span className="text-muted-foreground font-mono text-sm">
          {node.encoded || `naddr:${pointer.identifier || pointer.pubkey.slice(0, 8)}...`}
        </span>
      );
    }

    return <EventEmbed node={{ pointer }} depth={depth} />;
  }

  return null;
}
