import { Component, ReactNode, Suspense, lazy } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WindowInstance } from "@/types/app";

// Lazy load all viewer components for better code splitting
const NipRenderer = lazy(() =>
  import("./NipRenderer").then((m) => ({ default: m.NipRenderer })),
);
const ManPage = lazy(() => import("./ManPage"));
const ReqViewer = lazy(() => import("./ReqViewer"));
const EventDetailViewer = lazy(() =>
  import("./EventDetailViewer").then((m) => ({ default: m.EventDetailViewer })),
);
const ProfileViewer = lazy(() =>
  import("./ProfileViewer").then((m) => ({ default: m.ProfileViewer })),
);
const EncodeViewer = lazy(() => import("./EncodeViewer"));
const DecodeViewer = lazy(() => import("./DecodeViewer"));
const RelayViewer = lazy(() =>
  import("./RelayViewer").then((m) => ({ default: m.RelayViewer })),
);
const KindRenderer = lazy(() => import("./KindRenderer"));
const KindsViewer = lazy(() => import("./KindsViewer"));
const NipsViewer = lazy(() => import("./NipsViewer"));
const DebugViewer = lazy(() =>
  import("./DebugViewer").then((m) => ({ default: m.DebugViewer })),
);
const ConnViewer = lazy(() => import("./ConnViewer"));
const ChatViewer = lazy(() =>
  import("./ChatViewer").then((m) => ({ default: m.ChatViewer })),
);
const GroupListViewer = lazy(() =>
  import("./GroupListViewer").then((m) => ({ default: m.GroupListViewer })),
);
const AgentSessionViewer = lazy(() =>
  import("./agent/AgentSessionViewer").then((m) => ({
    default: m.AgentSessionViewer,
  })),
);
const ConcordViewer = lazy(() =>
  import("./ConcordViewer").then((m) => ({ default: m.ConcordViewer })),
);
// Lazy like every other window, and worth it here: `livekit-client` and its
// E2EE worker are a large chunk nobody who never calls should download.
const CallWindow = lazy(() =>
  import("./call/CallWindow").then((m) => ({ default: m.CallWindow })),
);
const SpellsViewer = lazy(() =>
  import("./SpellsViewer").then((m) => ({ default: m.SpellsViewer })),
);
const SpellbooksViewer = lazy(() =>
  import("./SpellbooksViewer").then((m) => ({ default: m.SpellbooksViewer })),
);
const BlossomViewer = lazy(() =>
  import("./BlossomViewer").then((m) => ({ default: m.BlossomViewer })),
);
const WalletViewer = lazy(() => import("./WalletViewer"));
const ZapWindow = lazy(() =>
  import("./ZapWindow").then((m) => ({ default: m.ZapWindow })),
);
const CountViewer = lazy(() => import("./CountViewer"));
const PostViewer = lazy(() =>
  import("./PostViewer").then((m) => ({ default: m.PostViewer })),
);
const SettingsViewer = lazy(() =>
  import("./SettingsViewer").then((m) => ({ default: m.SettingsViewer })),
);
const EventLogViewer = lazy(() =>
  import("./EventLogViewer").then((m) => ({ default: m.EventLogViewer })),
);
const AiViewer = lazy(() => import("./AiViewer"));
// Keeps the whole @kehto/* graph out of the main bundle.
const NappletViewer = lazy(() =>
  import("./NappletViewer").then((m) => ({ default: m.NappletViewer })),
);
const NsiteViewer = lazy(() =>
  import("./NsiteViewer").then((m) => ({ default: m.NsiteViewer })),
);
const NappletsViewer = lazy(() =>
  import("./NappletsViewer").then((m) => ({ default: m.NappletsViewer })),
);

// Loading fallback component
function ViewerLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Loading...</p>
      </div>
    </div>
  );
}

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

/**
 * The app for one window.
 *
 * A component rather than a `content` variable built in the caller, because JSX
 * constructed in a `try` is not covered by that `try`: React renders it later, so
 * every error the catch appeared to handle actually reached the parent. Rendering
 * the switch *inside* `WindowErrorBoundary` puts both kinds of failure — a throw
 * in a prop expression here, and a throw inside the app's own render — behind the
 * one mechanism that can catch them.
 */
function WindowContent({ window, onClose }: WindowRendererProps): ReactNode {
  /**
   * Bare `chat` names no conversation, so it is the browser — the same
   * component `concord` mounts, listing private conversations, relay groups and
   * communities in one sidebar.
   *
   * Routed by rewriting the appId rather than by a branch under `case "chat"`
   * so there is ONE place that renders the browser. The command it came from
   * still rides along, because a navigation writes the command back and
   * `chat <identifier>` is a single-conversation window: rebuilding a browser
   * window's command with an argument would reopen it as one pane.
   */
  const browser =
    window.appId === "chat" &&
    (!window.props.identifier || window.props.identifier.type === "browser");

  switch (browser ? "concord" : window.appId) {
    case "nip":
      return <NipRenderer nipId={window.props.number} />;
    case "apps":
      return <NappletsViewer />;
    case "nsite":
      return (
        <NsiteViewer pointer={window.props.pointer} windowId={window.id} />
      );
    case "app":
      return (
        <NappletViewer
          pointer={window.props.pointer}
          windowId={window.id}
          debug={window.props.debug}
        />
      );
    case "kind":
      return <KindRenderer kind={parseInt(window.props.number)} />;
    case "kinds":
      return <KindsViewer />;
    case "nips":
      return <NipsViewer />;
    case "man":
      return <ManPage cmd={window.props.cmd} />;
    case "req":
      return (
        <ReqViewer
          windowId={window.id}
          filter={window.props.filter}
          relays={window.props.relays}
          closeOnEose={window.props.closeOnEose}
          view={window.props.view}
          follow={window.props.follow}
          nip05Authors={window.props.nip05Authors}
          nip05PTags={window.props.nip05PTags}
          domainAuthors={window.props.domainAuthors}
          domainPTags={window.props.domainPTags}
          needsAccount={window.props.needsAccount}
        />
      );
    case "count":
      return (
        <CountViewer
          filter={window.props.filter}
          relays={window.props.relays}
          needsAccount={window.props.needsAccount}
        />
      );
    case "open":
      return <EventDetailViewer pointer={window.props.pointer} />;
    case "profile":
      return <ProfileViewer pubkey={window.props.pubkey} />;
    case "encode":
      return <EncodeViewer args={window.props.args} />;
    case "decode":
      return <DecodeViewer args={window.props.args} />;
    case "relay":
      return <RelayViewer url={window.props.url} />;
    case "debug":
      return <DebugViewer />;
    case "conn":
      return <ConnViewer />;
    case "chat":
      // Check if this is a group list (kind 10009) - render multi-room interface
      if (window.props.identifier?.type === "group-list") {
        return <GroupListViewer identifier={window.props.identifier} />;
      } else {
        return (
          <ChatViewer
            protocol={window.props.protocol}
            identifier={window.props.identifier}
            customTitle={window.customTitle}
          />
        );
      }
    case "spells":
      return <SpellsViewer />;
    case "spellbooks":
      return <SpellbooksViewer />;
    case "blossom":
      return (
        <BlossomViewer
          subcommand={window.props.subcommand}
          serverUrl={window.props.serverUrl}
          pubkey={window.props.pubkey}
          sourceUrl={window.props.sourceUrl}
          targetServer={window.props.targetServer}
          sha256={window.props.sha256}
          blobUrl={window.props.blobUrl}
          mediaType={window.props.mediaType}
        />
      );
    case "wallet":
      return <WalletViewer />;
    case "zap":
      return (
        <ZapWindow
          recipientPubkey={window.props.recipientPubkey}
          eventPointer={window.props.eventPointer}
          addressPointer={window.props.addressPointer}
          customTags={window.props.customTags}
          relays={window.props.relays}
          onClose={onClose}
        />
      );
    case "post":
      return <PostViewer windowId={window.id} />;
    case "settings":
      return <SettingsViewer />;
    case "agent":
      return (
        <AgentSessionViewer
          agent={window.props.agent}
          session={window.props.session}
        />
      );
    case "call":
      return (
        <CallWindow
          protocol={window.props.protocol}
          communityId={window.props.communityId}
          channelId={window.props.channelId}
          relayUrl={window.props.relayUrl}
          groupId={window.props.groupId}
          windowId={window.id}
        />
      );
    case "concord":
      return (
        <ConcordViewer
          command={browser ? "chat" : "concord"}
          communityId={window.props.communityId}
          channelId={window.props.channelId}
          dmPeer={window.props.dmPeer}
          groupId={window.props.groupId}
          groupRelay={window.props.groupRelay}
          windowId={window.id}
        />
      );
    case "ai":
      return (
        <AiViewer
          conversation={window.props.conversation}
          prompt={window.props.prompt}
          system={window.props.system}
          target={window.props.target}
          windowId={window.id}
        />
      );
    case "log":
      return <EventLogViewer />;
    default:
      return (
        <div className="p-4 text-muted-foreground">
          Unknown app: {window.appId}
        </div>
      );
  }
}

export function WindowRenderer({ window, onClose }: WindowRendererProps) {
  return (
    <WindowErrorBoundary
      windowTitle={window.title || window.appId.toUpperCase()}
      onClose={onClose}
    >
      <Suspense fallback={<ViewerLoading />}>
        <div className="h-full w-full overflow-auto">
          <WindowContent window={window} onClose={onClose} />
        </div>
      </Suspense>
    </WindowErrorBoundary>
  );
}
