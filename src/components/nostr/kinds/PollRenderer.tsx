import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";
import {
  ListCheck,
  ListChecks,
  Clock,
  CheckCircle2,
  CircleDot,
} from "lucide-react";
import { formatTimestamp } from "@/hooks/useLocale";
import { useGrimoire } from "@/core/state";
import {
  getPollQuestion,
  getPollOptions,
  getPollType,
  getPollEndsAt,
  isPollEnded,
} from "@/lib/nip88-helpers";

/**
 * Renderer for Kind 1068 - Poll (NIP-88)
 * Displays poll question, options, type, and deadline in feed view
 */
export function PollRenderer({ event }: BaseEventProps) {
  const { locale } = useGrimoire();

  const question = getPollQuestion(event);
  const options = getPollOptions(event);
  const pollType = getPollType(event);
  const endsAt = getPollEndsAt(event);
  const ended = isPollEnded(event);

  const endTimeText = endsAt
    ? formatTimestamp(endsAt, "absolute", locale.locale)
    : null;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Poll Header */}
        <div className="flex items-center gap-2 text-muted-foreground">
          {pollType === "multiplechoice" ? (
            <ListChecks className="size-4" />
          ) : (
            <ListCheck className="size-4" />
          )}
          <span className="text-xs uppercase tracking-wide">
            {pollType === "multiplechoice"
              ? "Multiple Choice"
              : "Single Choice"}{" "}
            Poll
          </span>
        </div>

        {/* Question */}
        <ClickableEventTitle
          event={event}
          className="text-base font-semibold text-foreground leading-tight"
        >
          {question || "Poll"}
        </ClickableEventTitle>

        {/* Options Preview */}
        {options.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {options.slice(0, 4).map((option) => (
              <div
                key={option.id}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                {pollType === "multiplechoice" ? (
                  <CheckCircle2 className="size-3.5 shrink-0" />
                ) : (
                  <CircleDot className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{option.label}</span>
              </div>
            ))}
            {options.length > 4 && (
              <span className="text-xs text-muted-foreground">
                +{options.length - 4} more options
              </span>
            )}
          </div>
        )}

        {/* Deadline */}
        {endsAt && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {ended ? (
              <span>Ended {endTimeText}</span>
            ) : (
              <span>Ends {endTimeText}</span>
            )}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
