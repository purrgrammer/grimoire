import { useMemo } from "react";
import {
  BaseEventContainer,
  BaseEventProps,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  getArticleTitle,
  getArticleSummary,
} from "applesauce-core/helpers/article";

/**
 * Renderer for Kind 30023 - Long-form Article
 * Displays article title and summary in feed
 */
export function Kind30023Renderer({ event }: BaseEventProps) {
  const title = useMemo(() => getArticleTitle(event), [event]);
  const summary = useMemo(() => getArticleSummary(event), [event]);

  return (
    <BaseEventContainer event={event}>
      <div dir="auto" className="flex flex-col gap-2">
        {/* Title */}
        {title && (
          <ClickableEventTitle
            event={event}
            windowTitle={title}
            className="text-lg font-bold text-foreground"
          >
            {title}
          </ClickableEventTitle>
        )}

        {/* Summary */}
        {summary && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {summary}
          </p>
        )}

        {/* No content fallback */}
        {!title && !summary && (
          <p className="text-sm text-muted-foreground italic">
            (Untitled article)
          </p>
        )}
      </div>
    </BaseEventContainer>
  );
}
