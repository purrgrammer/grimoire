import { getKindInfo } from "@/constants/kinds";
import { cn } from "@/lib/utils";
import { useGrimoire } from "@/core/state";

interface KindBadgeProps {
  kind: number;
  showIcon?: boolean;
  showName?: boolean;
  showKindNumber?: boolean;
  variant?: "default" | "compact" | "full";
  className?: string;
  iconClassname?: string;
  clickable?: boolean;
}

export function KindBadge({
  kind,
  showIcon: propShowIcon,
  showName: propShowName,
  showKindNumber: propShowKindNumber,
  variant = "default",
  className = "",
  iconClassname = "text-muted-foreground",
  clickable = false,
}: KindBadgeProps) {
  const { addWindow } = useGrimoire();
  const kindInfo = getKindInfo(kind);
  const Icon = kindInfo?.icon;

  const style = "inline-flex items-center gap-2 text-foreground";
  const interactiveStyle = clickable ? "cursor-crosshair" : "";

  const handleClick = () => {
    if (clickable) {
      addWindow("kind", { number: String(kind) });
    }
  };

  // Apply variant presets or use props
  let showIcon = propShowIcon ?? true;
  let showName = propShowName ?? true;
  let showKindNumber = propShowKindNumber ?? false;

  if (variant === "compact") {
    showIcon = true;
    showName = false;
    showKindNumber = false;
  } else if (variant === "full") {
    showIcon = true;
    showName = true;
    showKindNumber = true;
  }

  if (!kindInfo) {
    return (
      <div
        className={cn(style, interactiveStyle, className)}
        onClick={handleClick}
      >
        <span>Kind {kind}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(style, interactiveStyle, className)}
      title={`${kindInfo.description} (NIP-${kindInfo.nip})${clickable ? " - Click to view" : ""}`}
      onClick={handleClick}
    >
      {showIcon && Icon && <Icon className={cn("size-4", iconClassname)} />}
      {showName && (
        <span
          className={
            clickable
              ? "cursor-crosshair hover:underline decoration-dotted"
              : ""
          }
        >
          {kindInfo.name}
        </span>
      )}
      {showKindNumber && <span>({kind})</span>}
    </div>
  );
}
