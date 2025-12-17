import { MosaicWindow, MosaicBranch } from "react-mosaic-component";
import { WindowInstance } from "@/types/app";
import { WindowToolbar } from "./WindowToolbar";
import { WindowRenderer } from "./WindowRenderer";
import { useDynamicWindowTitle } from "./DynamicWindowTitle";
import { ErrorBoundary } from "./ErrorBoundary";

interface WindowTileProps {
  id: string;
  window: WindowInstance;
  path: MosaicBranch[];
  onClose: (id: string) => void;
  onEditCommand: () => void; // Callback to open CommandLauncher
}

export function WindowTile({
  id,
  window,
  path,
  onClose,
  onEditCommand,
}: WindowTileProps) {
  const { title, icon, tooltip } = useDynamicWindowTitle(window);
  const Icon = icon;

  // Convert title to string for MosaicWindow (which only accepts strings)
  // The actual title (with React elements) is rendered in the custom toolbar
  const titleString =
    typeof title === "string"
      ? title
      : tooltip || window.title || window.appId.toUpperCase();

  // Custom toolbar renderer to include icon
  const renderToolbar = () => {
    return (
      <div className="mosaic-window-toolbar draggable flex items-center justify-between w-full">
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
          window={window}
          onClose={() => onClose(id)}
          onEditCommand={onEditCommand}
        />
      </div>
    );
  };

  return (
    <MosaicWindow path={path} title={titleString} renderToolbar={renderToolbar}>
      <ErrorBoundary level="window">
        <WindowRenderer window={window} onClose={() => onClose(id)} />
      </ErrorBoundary>
    </MosaicWindow>
  );
}
