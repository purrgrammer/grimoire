import { ReactNode } from "react";

interface ChatHeaderProps {
  /** Optional prefix content (e.g., sidebar toggle) */
  prefix?: ReactNode;
  /** Main header content (title, buttons, etc.) */
  children: ReactNode;
  /** Optional suffix content (e.g., action buttons) */
  suffix?: ReactNode;
}

/**
 * ChatHeader - Generic header layout for chat windows
 * Provides a flexible layout with prefix, main content, and suffix areas
 */
export function ChatHeader({ prefix, children, suffix }: ChatHeaderProps) {
  return (
    <div className="pl-2 pr-0 border-b w-full py-0.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {prefix}
          {children}
        </div>
        {suffix && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-1">
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
}
