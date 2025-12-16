import { MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { WindowInstance } from "@/types/app";
import { WindowToolbar } from "./WindowToolbar";
import { WindowRenderer } from "./WindowRenderer";
import { useDynamicWindowTitle } from "./DynamicWindowTitle";
import { useGrimoire } from "@/core/state";

interface WindowTileProps {
  id: string;
  window: WindowInstance;
  path: MosaicBranch[];
  onClose: (id: string) => void;
}

export function WindowTile({ id, window, path, onClose }: WindowTileProps) {
  const { title, icon, tooltip } = useDynamicWindowTitle(window);
  const { setWindowBackgroundColor } = useGrimoire();
  const Icon = icon;

  // Custom toolbar renderer to include icon
  const renderToolbar = () => {
    return (
      <div
        className="mosaic-window-toolbar draggable flex items-center justify-between w-full transition-colors"
        style={
          window.backgroundColor
            ? { backgroundColor: window.backgroundColor + "30" }
            : undefined
        }
      >
        <div className="mosaic-window-title flex items-center gap-2 flex-1">
          {Icon && (
            <span title={tooltip} className="flex-shrink-0">
              <Icon className="size-4 text-muted-foreground" />
            </span>
          )}
          <span className="truncate" title={tooltip}>
            {title}
          </span>
        </div>
        <WindowToolbar
          onClose={() => onClose(id)}
          backgroundColor={window.backgroundColor}
          onBackgroundColorChange={(color) =>
            setWindowBackgroundColor(id, color)
          }
        />
      </div>
    );
  };

  return (
    <MosaicWindow path={path} title={title} renderToolbar={renderToolbar}>
      <WindowRenderer window={window} onClose={() => onClose(id)} />
    </MosaicWindow>
  );
}
