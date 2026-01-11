import type { Platform } from "@/lib/zapstore-helpers";
import {
  Globe,
  Smartphone,
  TabletSmartphone,
  Monitor,
  Laptop,
} from "lucide-react";

interface PlatformIconProps {
  platform: Platform;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function PlatformIcon({
  platform,
  showLabel = true,
  size = "sm",
}: PlatformIconProps) {
  const iconClass = size === "sm" ? "size-3" : "size-4";

  const getPlatformLabel = () => {
    switch (platform) {
      case "android":
        return "Android";
      case "ios":
        return "iOS";
      case "web":
        return "Web";
      case "macos":
        return "macOS";
      case "windows":
        return "Windows";
      case "linux":
        return "Linux";
      default:
        return platform;
    }
  };

  const getIcon = () => {
    const className = `${iconClass} text-muted-foreground`;
    switch (platform) {
      case "android":
        return <TabletSmartphone className={className} />;
      case "ios":
        return <Smartphone className={className} />;
      case "web":
        return <Globe className={className} />;
      case "macos":
        return <Laptop className={className} />;
      case "windows":
      case "linux":
        return <Monitor className={className} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {getIcon()}
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {getPlatformLabel()}
        </span>
      )}
    </div>
  );
}
