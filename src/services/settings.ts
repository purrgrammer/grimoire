/**
 * Global application settings with localStorage persistence
 */

import { BehaviorSubject } from "rxjs";

// ============================================================================
// Settings Types
// ============================================================================

/**
 * Post composition settings
 */
export interface PostSettings {
  /** Include Grimoire client tag in published events */
  includeClientTag: boolean;
}

/**
 * Appearance settings
 */
export interface AppearanceSettings {
  /** Show client tags in event UI */
  showClientTags: boolean;
}

/**
 * Complete application settings structure
 */
export interface AppSettings {
  __version: 1;
  post: PostSettings;
  appearance: AppearanceSettings;
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_POST_SETTINGS: PostSettings = {
  includeClientTag: true,
};

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  showClientTags: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  __version: 1,
  post: DEFAULT_POST_SETTINGS,
  appearance: DEFAULT_APPEARANCE_SETTINGS,
};

// ============================================================================
// Storage and Validation
// ============================================================================

const SETTINGS_STORAGE_KEY = "grimoire-settings-v2";

/**
 * Validate settings structure and return valid settings
 * Falls back to defaults for invalid sections
 */
function validateSettings(settings: unknown): AppSettings {
  if (!settings || typeof settings !== "object") {
    return DEFAULT_SETTINGS;
  }

  const s = settings as Record<string, unknown>;

  return {
    __version: 1,
    post: {
      ...DEFAULT_POST_SETTINGS,
      ...((s.post as object) || {}),
    },
    appearance: {
      ...DEFAULT_APPEARANCE_SETTINGS,
      ...((s.appearance as object) || {}),
    },
  };
}

/**
 * Migrate settings from old format to current version
 */
function migrateSettings(stored: unknown): AppSettings {
  if (!stored || typeof stored !== "object") {
    return DEFAULT_SETTINGS;
  }

  const s = stored as Record<string, unknown>;

  // If it's already current format, validate and return
  if (s.__version === 1) {
    return validateSettings(stored);
  }

  // Migrate from old flat structure
  const migrated: AppSettings = {
    ...DEFAULT_SETTINGS,
  };

  // Migrate old includeClientTag setting
  if ("includeClientTag" in s && typeof s.includeClientTag === "boolean") {
    migrated.post.includeClientTag = s.includeClientTag;
  }

  return migrated;
}

/**
 * Load settings from localStorage with migration support
 */
function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return migrateSettings(parsed);
    }

    // Check for old settings key
    const oldStored = localStorage.getItem("grimoire-settings");
    if (oldStored) {
      const parsed = JSON.parse(oldStored);
      const migrated = migrateSettings(parsed);
      // Save to new key
      saveSettings(migrated);
      // Clean up old key
      localStorage.removeItem("grimoire-settings");
      return migrated;
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
  return DEFAULT_SETTINGS;
}

/**
 * Save settings to localStorage with error handling
 */
function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

// ============================================================================
// Settings Manager
// ============================================================================

/**
 * Global settings manager with reactive updates
 */
class SettingsManager {
  private settings$ = new BehaviorSubject<AppSettings>(loadSettings());

  /**
   * Observable stream of settings
   */
  get stream$() {
    return this.settings$.asObservable();
  }

  /**
   * Get current settings value (non-reactive)
   */
  get value(): AppSettings {
    return this.settings$.value;
  }

  /**
   * Get a specific setting within a section
   */
  getSetting<
    S extends keyof Omit<AppSettings, "__version">,
    K extends keyof AppSettings[S],
  >(section: S, key: K): AppSettings[S][K] {
    return this.settings$.value[section][key];
  }

  /**
   * Update a specific setting within a section
   */
  updateSetting<
    S extends keyof Omit<AppSettings, "__version">,
    K extends keyof AppSettings[S],
  >(section: S, key: K, value: AppSettings[S][K]): void {
    const newSettings = {
      ...this.settings$.value,
      [section]: {
        ...this.settings$.value[section],
        [key]: value,
      },
    };
    this.settings$.next(newSettings);
    saveSettings(newSettings);
  }

  /**
   * Reset all settings to defaults
   */
  reset(): void {
    this.settings$.next(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  }
}

/**
 * Global settings manager instance
 */
export const settingsManager = new SettingsManager();
