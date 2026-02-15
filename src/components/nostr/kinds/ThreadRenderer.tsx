import { RichText } from "../RichText";
import {
  BaseEventContainer,
  type BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { getTagValue } from "applesauce-core/helpers";

/**
 * Renderer for Kind 11 - Thread (NIP-7D)
 * Thread root events with an optional title tag.
 * Shows the title as a clickable heading when present, followed by the content.
 */
export function ThreadRenderer({ event, depth = 0 }: BaseEventProps) {
  const title = getTagValue(event, "title");

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-1">
        {title && (
          <ClickableEventTitle
            event={event}
            className="font-semibold text-foreground"
          >
            {title}
          </ClickableEventTitle>
        )}
        <RichText event={event} className="text-sm" depth={depth} />
      </div>
    </BaseEventContainer>
  );
}
