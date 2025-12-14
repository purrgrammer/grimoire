import { useGrimoire } from "@/core/state";
import { MosaicNode } from "react-mosaic-component";

function renderTree(
  node: MosaicNode<string> | null,
  windows: Record<string, any>,
  prefix: string = "",
  isLast: boolean = true,
): string[] {
  if (!node) {
    return [`${prefix}(empty)`];
  }

  if (typeof node === "string") {
    // Leaf node - window ID
    const window = windows[node];
    const title = window?.title || "Unknown";
    const appId = window?.appId || "?";
    return [`${prefix}${isLast ? "└─" : "├─"} ${node} [${appId}] "${title}"`];
  }

  // Branch node
  const lines: string[] = [];
  const connector = isLast ? "└─" : "├─";
  const continuer = isLast ? "  " : "│ ";

  lines.push(
    `${prefix}${connector} ${node.direction === "row" ? "⇆ row" : "⇅ column"} (${node.splitPercentage || 50}%)`,
  );

  // Render first child
  const firstLines = renderTree(node.first, windows, prefix + continuer, false);
  lines.push(...firstLines);

  // Render second child
  const secondLines = renderTree(
    node.second,
    windows,
    prefix + continuer,
    true,
  );
  lines.push(...secondLines);

  return lines;
}

export function WinViewer() {
  const { state } = useGrimoire();
  const workspaceIds = Object.keys(state.workspaces);

  const lines: string[] = [];
  lines.push("grimoire state tree");
  lines.push("");

  // Global windows section
  const windowCount = Object.keys(state.windows).length;
  lines.push(`📦 global windows: ${windowCount}`);
  Object.values(state.windows).forEach((win) => {
    lines.push(`   ├─ ${win.id} [${win.appId}] "${win.title}"`);
  });
  lines.push("");

  // Workspaces section
  workspaceIds.forEach((wsId, index) => {
    const ws = state.workspaces[wsId];
    const isActive = wsId === state.activeWorkspaceId;
    const isLast = index === workspaceIds.length - 1;
    const prefix = isLast ? "└─" : "├─";
    const continuer = isLast ? "  " : "│ ";

    // Workspace header
    const wsDisplay = ws.label ? `${ws.number} "${ws.label}"` : `${ws.number}`;
    lines.push(
      `${prefix} ${isActive ? "●" : "○"} workspace: ${wsDisplay} (${wsId})`,
    );

    // Window IDs
    lines.push(`${continuer}├─ windowIds: [${ws.windowIds.join(", ")}]`);

    // Layout tree
    lines.push(`${continuer}└─ layout:`);
    const treeLines = renderTree(
      ws.layout,
      state.windows,
      `${continuer}   `,
      true,
    );
    lines.push(...treeLines);

    if (!isLast) {
      lines.push("│");
    }
  });

  return (
    <div className="p-4 h-full overflow-auto">
      <pre className="text-xs leading-relaxed">{lines.join("\n")}</pre>
    </div>
  );
}
