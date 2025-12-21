import { v4 as uuidv4 } from "uuid";
import type { MosaicNode } from "react-mosaic-component";
import type { GrimoireState, WindowInstance, Workspace } from "@/types/app";
import { SPELLBOOK_KIND } from "@/constants/kinds";
import {
  type SpellbookContent,
  type SpellbookEvent,
  type ParsedSpellbook,
} from "@/types/spell";
import { findLowestAvailableWorkspaceNumber } from "@/core/logic";

/**
 * Options for creating a spellbook
 */
export interface CreateSpellbookOptions {
  state: GrimoireState;
  workspaceIds?: string[]; // If omitted, saves all workspaces
  title: string;
  description?: string;
}

/**
 * Result of encoding a spellbook
 */
export interface EncodedSpellbook {
  eventProps: {
    kind: number;
    content: string;
    tags: [string, string, ...string[]][];
  };
  referencedSpells: string[];
}

/**
 * Helper to slugify a title for the 'd' tag
 */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with -
    .replace(/[^\w-]+/g, "") // Remove all non-word chars
    .replace(/--+/g, "-"); // Replace multiple - with single -
}

/**
 * Traverses a Mosaic layout tree to collect all window IDs
 */
function collectWindowIds(
  layout: MosaicNode<string> | null,
  ids: Set<string>,
): void {
  if (!layout) return;

  if (typeof layout === "string") {
    ids.add(layout);
    return;
  }

  collectWindowIds(layout.first, ids);
  collectWindowIds(layout.second, ids);
}

/**
 * Creates a Spellbook (Kind 30777) from the current state
 */
export function createSpellbook(
  options: CreateSpellbookOptions,
): EncodedSpellbook {
  const { state, title, description, workspaceIds } = options;

  // 1. Determine which workspaces to include
  const targetWorkspaceIds =
    workspaceIds && workspaceIds.length > 0
      ? workspaceIds
      : Object.keys(state.workspaces);

  const selectedWorkspaces: Record<string, Workspace> = {};
  const selectedWindows: Record<string, WindowInstance> = {};
  const referencedSpells = new Set<string>();
  const usedKinds = new Set<number>();

  // 2. Collect workspaces and their windows
  for (const wsId of targetWorkspaceIds) {
    const ws = state.workspaces[wsId];
    if (!ws) continue;

    selectedWorkspaces[wsId] = ws;

    // Collect window IDs from layout to ensure we only save what's actually visible/used
    // (though state.workspaces[id].windowIds should match, layout is the source of truth for structure)
    const windowIds = new Set<string>();
    collectWindowIds(ws.layout, windowIds);

    // Also include any loose windows in the workspace definition just in case
    ws.windowIds.forEach((id) => windowIds.add(id));

    // 3. Extract window instances and analyze kinds
    for (const winId of windowIds) {
      const window = state.windows[winId];
      if (window) {
        selectedWindows[winId] = window;
        if (window.spellId) {
          referencedSpells.add(window.spellId);
        }
        // Extract kinds from REQ windows for filtering/discovery
        if (window.appId === "req" && window.props?.filter?.kinds) {
          for (const kind of window.props.filter.kinds) {
            if (typeof kind === "number") {
              usedKinds.add(kind);
            }
          }
        }
      }
    }
  }

  // 4. Construct content payload
  const content: SpellbookContent = {
    version: 1,
    workspaces: selectedWorkspaces,
    windows: selectedWindows,
  };

  // 5. Construct tags
  const tags: [string, string, ...string[]][] = [
    ["d", slugify(title)],
    ["title", title],
    ["client", "grimoire"],
  ];

  if (description) {
    tags.push(["description", description]);
    tags.push(["alt", `Grimoire Spellbook: ${title}`]);
  } else {
    tags.push(["alt", `Grimoire Spellbook: ${title}`]);
  }

  // Add referenced spells
  for (const spellId of referencedSpells) {
    tags.push(["e", spellId, "", "mention"]);
  }

  // Add k tags for kinds used in REQ windows (enables filtering/discovery)
  const sortedKinds = Array.from(usedKinds).sort((a, b) => a - b);
  for (const kind of sortedKinds) {
    tags.push(["k", String(kind)]);
  }

  return {
    eventProps: {
      kind: SPELLBOOK_KIND,
      content: JSON.stringify(content),
      tags,
    },
    referencedSpells: Array.from(referencedSpells),
  };
}

/**
 * Parses a Spellbook event
 */
export function parseSpellbook(event: SpellbookEvent): ParsedSpellbook {
  let content: SpellbookContent;
  try {
    content = JSON.parse(event.content);
  } catch (_e) {
    throw new Error("Failed to parse spellbook content: Invalid JSON");
  }

  // Validate version (basic check)
  if (!content.version || content.version < 1) {
    console.warn(
      "Spellbook missing version or invalid, attempting to load anyway",
    );
  }

  // Extract metadata
  const dTag = event.tags.find((t) => t[0] === "d");
  const titleTag = event.tags.find((t) => t[0] === "title");
  const descTag = event.tags.find((t) => t[0] === "description");
  const eTags = event.tags.filter((t) => t[0] === "e").map((t) => t[1]);

  return {
    slug: dTag?.[1] || "",
    title: titleTag?.[1] || "Untitled Spellbook",
    description: descTag?.[1],
    content,
    referencedSpells: eTags,
    event,
  };
}

/**
 * Recursively updates window IDs in a Mosaic layout tree
 */
function updateLayoutIds(
  layout: MosaicNode<string> | null,
  idMap: Map<string, string>,
): MosaicNode<string> | null {
  if (!layout) return null;

  if (typeof layout === "string") {
    // If we have a mapping for this ID, return the new one.
    // If not (shouldn't happen in valid spellbooks), return old one.
    return idMap.get(layout) || layout;
  }

  return {
    ...layout,
    first: updateLayoutIds(layout.first, idMap)!,
    second: updateLayoutIds(layout.second, idMap)!,
  };
}

/**
 * Compares two spellbook versions to detect conflicts
 *
 * @param local - Local spellbook from Dexie
 * @param network - Network spellbook from Nostr event
 * @returns Comparison result with conflict status and differences
 */
export function compareSpellbookVersions(
  local: {
    createdAt: number;
    content: SpellbookContent;
    eventId?: string;
  },
  network: {
    created_at: number;
    content: SpellbookContent;
    id: string;
  },
): {
  hasConflict: boolean;
  newerVersion: "local" | "network" | "same";
  differences: {
    workspaceCount: { local: number; network: number };
    windowCount: { local: number; network: number };
    lastModified: { local: number; network: number };
    contentDiffers: boolean;
  };
} {
  const localTimestamp = local.createdAt;
  const networkTimestamp = network.created_at * 1000; // Convert to ms

  // Count workspaces and windows
  const localWorkspaceCount = Object.keys(local.content.workspaces).length;
  const networkWorkspaceCount = Object.keys(network.content.workspaces).length;
  const localWindowCount = Object.keys(local.content.windows).length;
  const networkWindowCount = Object.keys(network.content.windows).length;

  // Check if content differs (simple stringify comparison)
  const localContentStr = JSON.stringify(local.content);
  const networkContentStr = JSON.stringify(network.content);
  const contentDiffers = localContentStr !== networkContentStr;

  // Determine newer version
  let newerVersion: "local" | "network" | "same";
  if (localTimestamp > networkTimestamp) {
    newerVersion = "local";
  } else if (networkTimestamp > localTimestamp) {
    newerVersion = "network";
  } else {
    newerVersion = "same";
  }

  // Determine if there's a conflict
  // Conflict exists if:
  // 1. Content differs AND
  // 2. Local has been published (has eventId) AND
  // 3. The event IDs don't match (different versions)
  const hasConflict =
    contentDiffers && !!local.eventId && local.eventId !== network.id;

  return {
    hasConflict,
    newerVersion,
    differences: {
      workspaceCount: {
        local: localWorkspaceCount,
        network: networkWorkspaceCount,
      },
      windowCount: {
        local: localWindowCount,
        network: networkWindowCount,
      },
      lastModified: {
        local: localTimestamp,
        network: networkTimestamp,
      },
      contentDiffers,
    },
  };
}

/**
 * Imports a parsed spellbook into the current state.
 * Regenerates IDs to avoid collisions.
 */
export function loadSpellbook(
  state: GrimoireState,
  spellbook: ParsedSpellbook,
): GrimoireState {
  const { workspaces, windows } = spellbook.content;

  // Maps to track old -> new IDs
  const workspaceIdMap = new Map<string, string>();
  const windowIdMap = new Map<string, string>();

  // 1. Start fresh
  const newWorkspaces: Record<string, Workspace> = {};
  const newWindows: Record<string, WindowInstance> = {};

  // 2. Process Windows first to build ID map
  Object.values(windows).forEach((window) => {
    const newId = uuidv4();
    windowIdMap.set(window.id, newId);

    // Create new window instance with new ID
    newWindows[newId] = {
      ...window,
      id: newId,
    };
  });

  // 3. Process Workspaces
  // Sort by original number to preserve order
  const sortedWorkspaces = Object.values(workspaces).sort(
    (a, b) => a.number - b.number,
  );

  let firstNewWorkspaceId: string | null = null;

  sortedWorkspaces.forEach((ws) => {
    const newWsId = uuidv4();
    if (!firstNewWorkspaceId) firstNewWorkspaceId = newWsId;

    workspaceIdMap.set(ws.id, newWsId);

    // Update window IDs in the windowIds array
    const newWindowIds = ws.windowIds
      .map((oldId) => windowIdMap.get(oldId))
      .filter((id): id is string => !!id);

    // Update layout tree with new window IDs
    const newLayout = updateLayoutIds(ws.layout, windowIdMap);

    // Assign sequential numbers starting from 1
    const targetNumber = findLowestAvailableWorkspaceNumber(newWorkspaces);

    newWorkspaces[newWsId] = {
      ...ws,
      id: newWsId,
      number: targetNumber,
      layout: newLayout,
      windowIds: newWindowIds,
    };
  });

  return {
    ...state,
    workspaces: newWorkspaces,
    windows: newWindows,
    activeWorkspaceId: firstNewWorkspaceId || state.activeWorkspaceId,
    activeSpellbook: {
      id: spellbook.event?.id || spellbook.localId || uuidv4(),
      slug: spellbook.slug,
      title: spellbook.title,
      description: spellbook.description,
      pubkey: spellbook.event?.pubkey,
      // Enhanced fields for UX clarity:
      source: spellbook.source || (spellbook.event ? "network" : "local"),
      localId: spellbook.localId,
      isPublished: spellbook.isPublished ?? !!spellbook.event,
    },
  };
}
