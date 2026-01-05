import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import { getArticleTitle } from "applesauce-common/helpers/article";

/**
 * Renderer for Kind 30817 - Community NIP
 * Displays NIP identifier, title and summary in feed
 */
export function CommunityNIPRenderer({ event }: BaseEventProps) {
  const title = getArticleTitle(event);

  return (
    <BaseEventContainer event={event}>
      <div dir="auto" className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="text-lg font-bold text-foreground flex-1"
        >
          {title}
        </ClickableEventTitle>
      </div>
    </BaseEventContainer>
  );
}
