import { Component, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WindowInstance } from "@/types/app";
import { NipRenderer } from "./NipRenderer";
import ManPage from "./ManPage";
import ReqViewer from "./ReqViewer";
import { EventDetailViewer } from "./EventDetailViewer";
import { ProfileViewer } from "./ProfileViewer";
import EncodeViewer from "./EncodeViewer";
import DecodeViewer from "./DecodeViewer";
import { RelayViewer } from "./RelayViewer";
import KindRenderer from "./KindRenderer";
import KindsViewer from "./KindsViewer";
import Feed from "./nostr/Feed";
import { WinViewer } from "./WinViewer";
import { DebugViewer } from "./DebugViewer";
import ConnViewer from "./ConnViewer";
import LoginViewer from "./LoginViewer";

interface WindowRendererProps {
  window: WindowInstance;
  onClose: () => void;
}

interface WindowErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class WindowErrorBoundary extends Component<
  { children: ReactNode; windowTitle: string; onClose: () => void },
  WindowErrorBoundaryState
> {
  constructor(props: {
    children: ReactNode;
    windowTitle: string;
    onClose: () => void;
  }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): WindowErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `Window "${this.props.windowTitle}" crashed:`,
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4">
          <div className="border border-red-500 bg-red-50 dark:bg-red-950 rounded-md p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <h3 className="font-semibold text-red-900 dark:text-red-100">
                  Window Crashed
                </h3>
                <p className="text-sm text-red-800 dark:text-red-200">
                  {this.state.error?.message ||
                    "An unexpected error occurred in this window."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={this.props.onClose}
                  className="mt-2"
                >
                  Close Window
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function WindowRenderer({ window, onClose }: WindowRendererProps) {
  let content: ReactNode;

  try {
    switch (window.appId) {
      case "nip":
        content = <NipRenderer nipId={window.props.number} />;
        break;
      case "feed":
        content = <Feed className="h-full w-full overflow-auto" />;
        break;
      case "win":
        content = <WinViewer />;
        break;
      case "kind":
        content = <KindRenderer kind={parseInt(window.props.number)} />;
        break;
      case "kinds":
        content = <KindsViewer />;
        break;
      case "man":
        content = <ManPage cmd={window.props.cmd} />;
        break;
      case "req":
        content = (
          <ReqViewer
            filter={window.props.filter}
            relays={window.props.relays}
            closeOnEose={window.props.closeOnEose}
            nip05Authors={window.props.nip05Authors}
            nip05PTags={window.props.nip05PTags}
          />
        );
        break;
      case "open":
        content = <EventDetailViewer pointer={window.props.pointer} />;
        break;
      case "profile":
        content = <ProfileViewer pubkey={window.props.pubkey} />;
        break;
      case "encode":
        content = <EncodeViewer args={window.props.args} />;
        break;
      case "decode":
        content = <DecodeViewer args={window.props.args} />;
        break;
      case "relay":
        content = <RelayViewer url={window.props.url} />;
        break;
      case "debug":
        content = <DebugViewer />;
        break;
      case "conn":
        content = <ConnViewer />;
        break;
      case "login":
        content = <LoginViewer />;
        break;
      default:
        content = (
          <div className="p-4 text-muted-foreground">
            Unknown app: {window.appId}
          </div>
        );
    }
  } catch (error) {
    content = (
      <div className="p-4">
        <div className="border border-red-500 bg-red-50 dark:bg-red-950 rounded-md p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900 dark:text-red-100">
                Failed to render window
              </h3>
              <p className="text-sm text-red-800 dark:text-red-200 mt-1">
                {error instanceof Error
                  ? error.message
                  : "An unexpected error occurred"}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <WindowErrorBoundary windowTitle={window.title} onClose={onClose}>
      <div className="h-full w-full overflow-auto">{content}</div>
    </WindowErrorBoundary>
  );
}
