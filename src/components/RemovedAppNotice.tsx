import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAddWindow } from "@/core/state";
import type { RemovedApp } from "@/lib/removed-apps";

interface RemovedAppNoticeProps {
  app: RemovedApp;
  /** The saved window's props, read only for what the replacement can use. */
  props: Record<string, unknown> | undefined;
  onClose: () => void;
}

/**
 * What a saved window shows when the app it names was removed.
 *
 * It runs nothing of the old app and opens nothing on its own: the reader sees
 * what was removed, can close the window, and — where a replacement exists —
 * open it with a click.
 */
export function RemovedAppNotice({
  app,
  props,
  onClose,
}: RemovedAppNoticeProps) {
  const addWindow = useAddWindow();

  const openReplacement = () => {
    if (app.replacement !== "chat") return;
    // The browser on the same community, when the old window named one.
    const communityId =
      typeof props?.communityId === "string" ? props.communityId : undefined;
    addWindow(
      "chat",
      {
        identifier: { type: "browser" },
        ...(communityId ? { communityId } : {}),
      },
      "chat",
    );
  };

  return (
    <div
      role="status"
      className="h-full w-full flex items-center justify-center p-4"
    >
      <div className="w-full min-w-0 max-w-sm space-y-3 text-center break-words">
        <Ban className="mx-auto size-8 text-muted-foreground" />
        <h2 className="font-semibold">
          <code className="font-mono">{app.command}</code> is no longer
          available
        </h2>
        <p className="text-sm text-muted-foreground">
          This window was saved by a command Grimoire removed, so there is
          nothing to show here.
          {app.replacement && (
            <>
              {" "}
              Use <code className="font-mono">{app.replacement}</code> instead.
            </>
          )}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {app.replacement && (
            <Button size="sm" onClick={openReplacement}>
              Open {app.replacement}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onClose}>
            Close window
          </Button>
        </div>
      </div>
    </div>
  );
}
