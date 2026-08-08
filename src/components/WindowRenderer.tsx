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
const NappletsViewer = lazy(() =>
  import("./NappletsViewer").then((m) => ({ default: m.NappletsViewer })),
);
const NappletPermissionsViewer = lazy(() =>
  import("./NappletPermissionsViewer").then((m) => ({
    default: m.NappletPermissionsViewer,
  })),
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

export function WindowRenderer({ window, onClose }: WindowRendererProps) {
  let content: ReactNode;

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

  try {
    switch (browser ? "concord" : window.appId) {
      case "nip":
        content = <NipRenderer nipId={window.props.number} />;
        break;
      case "apps":
        content = <NappletsViewer />;
        break;
      case "permissions":
        content = <NappletPermissionsViewer />;
        break;
      case "app":
        content = (
          <NappletViewer pointer={window.props.pointer} windowId={window.id} />
        );
        break;
      case "kind":
        content = <KindRenderer kind={parseInt(window.props.number)} />;
        break;
      case "kinds":
        content = <KindsViewer />;
        break;
      case "nips":
        content = <NipsViewer />;
        break;
      case "man":
        content = <ManPage cmd={window.props.cmd} />;
        break;
      case "req":
        content = (
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
        break;
      case "count":
        content = (
          <CountViewer
            filter={window.props.filter}
            relays={window.props.relays}
            needsAccount={window.props.needsAccount}
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
      case "chat":
        // Bare `chat`: no conversation named, so this is the browser — private
        // conversations, relay groups and Concord communities in one sidebar.
        // The same component `concord` mounts; only the command it writes back
        // differs, and that difference matters because `chat <identifier>` is a
        // single-conversation window.
        // Check if this is a group list (kind 10009) - render multi-room interface
        if (window.props.identifier?.type === "group-list") {
          content = <GroupListViewer identifier={window.props.identifier} />;
        } else {
          content = (
            <ChatViewer
              protocol={window.props.protocol}
              identifier={window.props.identifier}
              customTitle={window.customTitle}
            />
          );
        }
        break;
      case "agent":
        content = (
          <AgentSessionViewer
            agent={window.props.agent}
            session={window.props.session}
          />
        );
        break;
      case "concord":
        content = (
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
        break;
      // One appId, two spaces — a Concord channel's call and a NIP-29 group's.
      // `CallWindow` picks; see the note there.
      case "call":
        content = (
          <CallWindow
            protocol={window.props.protocol}
            communityId={window.props.communityId}
            channelId={window.props.channelId}
            relayUrl={window.props.relayUrl}
            groupId={window.props.groupId}
            windowId={window.id}
          />
        );
        break;
      case "spells":
        content = <SpellsViewer />;
        break;
      case "spellbooks":
        content = <SpellbooksViewer />;
        break;
      case "blossom":
        content = (
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
        break;
      case "wallet":
        content = <WalletViewer />;
        break;
      case "zap":
        content = (
          <ZapWindow
            recipientPubkey={window.props.recipientPubkey}
            eventPointer={window.props.eventPointer}
            addressPointer={window.props.addressPointer}
            customTags={window.props.customTags}
            relays={window.props.relays}
            zapTarget={window.props.zapTarget}
            onClose={onClose}
          />
        );
        break;
      case "post":
        content = <PostViewer windowId={window.id} />;
        break;
      case "settings":
        content = <SettingsViewer />;
        break;
      case "log":
        content = <EventLogViewer />;
        break;
      case "ai":
        content = (
          <AiViewer
            conversation={window.props.conversation}
            prompt={window.props.prompt}
            system={window.props.system}
            target={window.props.target}
            windowId={window.id}
          />
        );
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
    <WindowErrorBoundary
      windowTitle={window.title || window.appId.toUpperCase()}
      onClose={onClose}
    >
      <Suspense fallback={<ViewerLoading />}>
        <div className="h-full w-full overflow-auto">{content}</div>
      </Suspense>
    </WindowErrorBoundary>
  );
}
