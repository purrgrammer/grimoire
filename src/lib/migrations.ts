/**
 * State Migration System
 *
 * Handles schema version upgrades and state validation
 * Ensures data integrity across application updates
 */

import { GrimoireState } from "@/types/app";
import { toast } from "sonner";

export const CURRENT_VERSION = 8;

/**
 * Migration function type
 */
type MigrationFn = (state: any) => any;

/**
 * Migration registry - add new migrations here
 * Each migration transforms state from version N to N+1
 */
const migrations: Record<number, MigrationFn> = {
  // Migration from v5 to v6 - adds __version field
  5: (state: any) => {
    return {
      __version: 6,
      ...state,
    };
  },
  // Migration from v6 to v7 - separates workspace number from label
  6: (state: any) => {
    const migratedWorkspaces: Record<string, any> = {};

    // Convert each workspace from old format (label as string) to new format (number + optional label)
    for (const [id, workspace] of Object.entries(state.workspaces || {})) {
      const ws = workspace as any;

      // Try to parse the label as a number
      const parsedNumber = parseInt(ws.label, 10);

      if (!isNaN(parsedNumber)) {
        // Label is numeric - use it as the number, no label
        migratedWorkspaces[id] = {
          ...ws,
          number: parsedNumber,
          label: undefined,
        };
      } else {
        // Label is not numeric - assign it the next available number, keep label
        // Find the highest number used so far
        const usedNumbers = Object.values(migratedWorkspaces).map(
          (w: any) => w.number,
        );
        const maxNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) : 0;

        migratedWorkspaces[id] = {
          ...ws,
          number: maxNumber + 1,
          label: ws.label,
        };
      }
    }

    return {
      ...state,
      __version: 7,
      workspaces: migratedWorkspaces,
    };
  },
  // Migration from v7 to v8 - adds global layoutConfig
  7: (state: any) => {
    // Add global layoutConfig with smart defaults
    return {
      ...state,
      __version: 8,
      layoutConfig: {
        insertionMode: "smart", // Smart auto-balancing
        splitPercentage: 50, // Equal split
        insertionPosition: "second", // New windows on right/bottom
        autoPreset: undefined, // No preset by default
      },
    };
  },
};

/**
 * Validate state structure
 * Basic checks to ensure state is not corrupted
 */
export function validateState(state: any): state is GrimoireState {
  try {
    // Must be an object
    if (!state || typeof state !== "object") {
      return false;
    }

    // Must have required top-level fields
    if (
      !state.windows ||
      !state.workspaces ||
      !state.activeWorkspaceId ||
      !state.layoutConfig ||
      typeof state.__version !== "number"
    ) {
      return false;
    }

    // layoutConfig must be an object
    if (typeof state.layoutConfig !== "object") {
      return false;
    }

    // Windows must be an object
    if (typeof state.windows !== "object") {
      return false;
    }

    // Workspaces must be an object
    if (typeof state.workspaces !== "object") {
      return false;
    }

    // Active workspace must exist
    if (!state.workspaces[state.activeWorkspaceId]) {
      return false;
    }

    // All window IDs in workspaces must exist in windows
    for (const workspace of Object.values(state.workspaces)) {
      const ws = workspace as any;
      if (!Array.isArray(ws.windowIds)) {
        return false;
      }
      for (const windowId of ws.windowIds) {
        if (!state.windows[windowId]) {
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    console.error("[Migrations] Validation error:", error);
    return false;
  }
}

/**
 * Migrate state from old version to current version
 * Applies migrations sequentially
 */
export function migrateState(state: any): GrimoireState {
  let currentState = state;
  const startVersion = state.__version || 5; // Default to 5 if no version

  console.log(
    `[Migrations] Migrating from v${startVersion} to v${CURRENT_VERSION}`,
  );

  // Apply migrations sequentially
  for (let version = startVersion; version < CURRENT_VERSION; version++) {
    const migration = migrations[version];
    if (migration) {
      console.log(
        `[Migrations] Applying migration v${version} -> v${version + 1}`,
      );
      try {
        currentState = migration(currentState);
      } catch (error) {
        console.error(`[Migrations] Migration v${version} failed:`, error);
        throw new Error(
          `Failed to migrate from version ${version} to ${version + 1}`,
        );
      }
    }
  }

  // Validate migrated state
  if (!validateState(currentState)) {
    throw new Error("Migrated state failed validation");
  }

  return currentState as GrimoireState;
}

/**
 * Load state from localStorage with migration and validation
 */
export function loadStateWithMigration(
  key: string,
  initialState: GrimoireState,
): GrimoireState {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return initialState;
    }

    const parsed = JSON.parse(stored);

    // Check if migration is needed
    const storedVersion = parsed.__version || 5;
    if (storedVersion < CURRENT_VERSION) {
      console.log(
        `[Migrations] State version outdated (v${storedVersion}), migrating...`,
      );
      const migrated = migrateState(parsed);

      // Save migrated state
      localStorage.setItem(key, JSON.stringify(migrated));

      toast.success("State Updated", {
        description: `Migrated from v${storedVersion} to v${CURRENT_VERSION}`,
      });

      return migrated;
    }

    // Validate current version state
    if (!validateState(parsed)) {
      console.warn("[Migrations] State validation failed, using initial state");
      toast.error("State Corrupted", {
        description: "Your state was corrupted and has been reset.",
      });
      return initialState;
    }

    return parsed;
  } catch (error) {
    console.error("[Migrations] Failed to load state:", error);
    toast.error("Failed to Load State", {
      description: "Using default state. Your data may have been lost.",
    });
    return initialState;
  }
}

/**
 * Export state to JSON file
 */
export function exportState(state: GrimoireState): void {
  try {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grimoire-state-v${state.__version}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("State Exported", {
      description: "Your state has been downloaded as JSON",
    });
  } catch (error) {
    console.error("[Migrations] Export failed:", error);
    toast.error("Export Failed", {
      description: "Could not export state",
    });
  }
}

/**
 * Import state from JSON file
 */
export function importState(
  file: File,
  callback: (state: GrimoireState) => void,
): void {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const json = e.target?.result as string;
      const parsed = JSON.parse(json);

      // Validate and migrate imported state
      const storedVersion = parsed.__version || 5;
      let finalState: GrimoireState;

      if (storedVersion < CURRENT_VERSION) {
        console.log(
          `[Migrations] Imported state is v${storedVersion}, migrating...`,
        );
        finalState = migrateState(parsed);
      } else if (!validateState(parsed)) {
        throw new Error("Imported state failed validation");
      } else {
        finalState = parsed;
      }

      callback(finalState);

      toast.success("State Imported", {
        description: `Loaded state from v${storedVersion}`,
      });
    } catch (error) {
      console.error("[Migrations] Import failed:", error);
      toast.error("Import Failed", {
        description: "Invalid or corrupted state file",
      });
    }
  };

  reader.onerror = () => {
    toast.error("Import Failed", {
      description: "Could not read file",
    });
  };

  reader.readAsText(file);
}
