/**
 * Global application settings with namespaced structure
 * Manages user preferences with localStorage persistence, validation, and migrations
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
  /** Default relay selection preference (user-relays, aggregators, custom) */
  defaultRelayMode: "user-relays" | "aggregators" | "custom";
  /** Custom relay list for posting (when defaultRelayMode is "custom") */
  customPostRelays: string[];
}

/**
 * Appearance and theme settings
 */
export interface AppearanceSettings {
  /** Theme mode (light, dark, or system) */
  theme: "light" | "dark" | "system";
  /** Show client tags in event UI */
  showClientTags: boolean;
  /** Event kinds to render in compact mode */
  compactModeKinds: number[];
  /** Font size multiplier (0.8 = 80%, 1.0 = 100%, 1.2 = 120%) */
  fontSizeMultiplier: number;
  /** Enable UI animations */
  animationsEnabled: boolean;
  /** Accent color (hue value 0-360) */
  accentHue: number;
}

/**
 * Relay configuration settings
 */
export interface RelaySettings {
  /** Fallback aggregator relays when user has no relay list */
  fallbackRelays: string[];
  /** Discovery relays for bootstrapping (NIP-05, relay lists, etc.) */
  discoveryRelays: string[];
  /** Enable NIP-65 outbox model for finding events */
  outboxEnabled: boolean;
  /** Fallback to aggregators if outbox fails */
  outboxFallbackEnabled: boolean;
  /** Relay connection timeout in milliseconds */
  relayTimeout: number;
  /** Maximum concurrent relay connections per query */
  maxRelaysPerQuery: number;
  /** Automatically connect to inbox relays when viewing DMs */
  autoConnectInbox: boolean;
}

/**
 * Privacy and security settings
 */
export interface PrivacySettings {
  /** Share read receipts (NIP-15) */
  shareReadReceipts: boolean;
  /** Blur wallet balances in UI */
  blurWalletBalances: boolean;
  /** Blur sensitive content (marked with content-warning tag) */
  blurSensitiveContent: boolean;
  /** Warn before opening external links */
  warnExternalLinks: boolean;
}

/**
 * Local database and caching settings
 */
export interface DatabaseSettings {
  /** Maximum events to cache in IndexedDB (0 = unlimited) */
  maxEventsCached: number;
  /** Auto-cleanup old events after N days (0 = never) */
  autoCleanupDays: number;
  /** Enable IndexedDB caching */
  cacheEnabled: boolean;
  /** Cache profile metadata */
  cacheProfiles: boolean;
  /** Cache relay lists */
  cacheRelayLists: boolean;
}

/**
 * Notification preferences
 */
export interface NotificationSettings {
  /** Enable browser notifications */
  enabled: boolean;
  /** Notify on mentions */
  notifyOnMention: boolean;
  /** Notify on zaps received */
  notifyOnZap: boolean;
  /** Notify on replies */
  notifyOnReply: boolean;
  /** Play sound on notification */
  soundEnabled: boolean;
}

/**
 * Developer and debug settings
 */
export interface DeveloperSettings {
  /** Enable debug mode */
  debugMode: boolean;
  /** Show event IDs in UI */
  showEventIds: boolean;
  /** Console log level */
  logLevel: "none" | "error" | "warn" | "info" | "debug";
  /** Enable experimental features */
  experimentalFeatures: boolean;
  /** Show performance metrics */
  showPerformanceMetrics: boolean;
}

/**
 * Complete application settings structure
 * Version 1: Initial namespaced structure
 */
export interface AppSettings {
  __version: 1;
  post: PostSettings;
  appearance: AppearanceSettings;
  relay: RelaySettings;
  privacy: PrivacySettings;
  database: DatabaseSettings;
  notifications: NotificationSettings;
  developer: DeveloperSettings;
}

// ============================================================================
// Default Settings
// ============================================================================

const DEFAULT_POST_SETTINGS: PostSettings = {
  includeClientTag: true,
  defaultRelayMode: "user-relays",
  customPostRelays: [],
};

const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: "dark",
  showClientTags: true,
  compactModeKinds: [6, 7, 16, 9735], // reactions, reposts, zaps
  fontSizeMultiplier: 1.0,
  animationsEnabled: true,
  accentHue: 280, // Purple
};

const DEFAULT_RELAY_SETTINGS: RelaySettings = {
  fallbackRelays: [
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://nos.lol",
    "wss://relay.primal.net",
  ],
  discoveryRelays: [
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://purplepag.es",
  ],
  outboxEnabled: true,
  outboxFallbackEnabled: true,
  relayTimeout: 5000,
  maxRelaysPerQuery: 10,
  autoConnectInbox: true,
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  shareReadReceipts: false,
  blurWalletBalances: false,
  blurSensitiveContent: true,
  warnExternalLinks: false,
};

const DEFAULT_DATABASE_SETTINGS: DatabaseSettings = {
  maxEventsCached: 50000,
  autoCleanupDays: 30,
  cacheEnabled: true,
  cacheProfiles: true,
  cacheRelayLists: true,
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  notifyOnMention: true,
  notifyOnZap: true,
  notifyOnReply: true,
  soundEnabled: false,
};

const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  debugMode: false,
  showEventIds: false,
  logLevel: "warn",
  experimentalFeatures: false,
  showPerformanceMetrics: false,
};

export const DEFAULT_SETTINGS: AppSettings = {
  __version: 1,
  post: DEFAULT_POST_SETTINGS,
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  relay: DEFAULT_RELAY_SETTINGS,
  privacy: DEFAULT_PRIVACY_SETTINGS,
  database: DEFAULT_DATABASE_SETTINGS,
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  developer: DEFAULT_DEVELOPER_SETTINGS,
};

// ============================================================================
// Storage and Validation
// ============================================================================

const SETTINGS_STORAGE_KEY = "grimoire-settings-v2";

/**
 * Validate settings structure and return valid settings
 * Falls back to defaults for invalid sections
 */
function validateSettings(settings: any): AppSettings {
  if (!settings || typeof settings !== "object") {
    return DEFAULT_SETTINGS;
  }

  // Ensure all namespaces exist
  return {
    __version: 1,
    post: { ...DEFAULT_POST_SETTINGS, ...(settings.post || {}) },
    appearance: {
      ...DEFAULT_APPEARANCE_SETTINGS,
      ...(settings.appearance || {}),
    },
    relay: { ...DEFAULT_RELAY_SETTINGS, ...(settings.relay || {}) },
    privacy: { ...DEFAULT_PRIVACY_SETTINGS, ...(settings.privacy || {}) },
    database: { ...DEFAULT_DATABASE_SETTINGS, ...(settings.database || {}) },
    notifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...(settings.notifications || {}),
    },
    developer: { ...DEFAULT_DEVELOPER_SETTINGS, ...(settings.developer || {}) },
  };
}

/**
 * Migrate settings from old format to current version
 */
function migrateSettings(stored: any): AppSettings {
  // If it's already v2 format, validate and return
  if (stored && stored.__version === 1) {
    return validateSettings(stored);
  }

  // Migrate from v1 (flat structure with only includeClientTag)
  const migrated: AppSettings = {
    ...DEFAULT_SETTINGS,
  };

  if (stored && typeof stored === "object") {
    // Migrate old includeClientTag setting
    if ("includeClientTag" in stored) {
      migrated.post.includeClientTag = stored.includeClientTag;
    }
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
 * Use settings$ to reactively observe settings changes
 * Use getSection() for non-reactive access to a settings section
 * Use updateSection() to update an entire section
 * Use updateSetting() to update a specific setting within a section
 */
class SettingsManager {
  private settings$ = new BehaviorSubject<AppSettings>(loadSettings());

  /**
   * Observable stream of settings
   * Subscribe to get notified of changes
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
   * Get a specific settings section
   */
  getSection<K extends keyof Omit<AppSettings, "__version">>(
    section: K,
  ): AppSettings[K] {
    return this.settings$.value[section];
  }

  /**
   * Get a specific setting within a section
   * @example getSetting("post", "includeClientTag")
   */
  getSetting<
    S extends keyof Omit<AppSettings, "__version">,
    K extends keyof AppSettings[S],
  >(section: S, key: K): AppSettings[S][K] {
    return this.settings$.value[section][key];
  }

  /**
   * Update an entire settings section
   * Automatically persists to localStorage
   */
  updateSection<K extends keyof Omit<AppSettings, "__version">>(
    section: K,
    updates: Partial<AppSettings[K]>,
  ): void {
    const newSettings = {
      ...this.settings$.value,
      [section]: {
        ...this.settings$.value[section],
        ...updates,
      },
    };
    this.settings$.next(newSettings);
    saveSettings(newSettings);
  }

  /**
   * Update a specific setting within a section
   * Automatically persists to localStorage
   * @example updateSetting("post", "includeClientTag", true)
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

  /**
   * Reset a specific section to defaults
   */
  resetSection<K extends keyof Omit<AppSettings, "__version">>(
    section: K,
  ): void {
    const newSettings = {
      ...this.settings$.value,
      [section]: DEFAULT_SETTINGS[section],
    };
    this.settings$.next(newSettings);
    saveSettings(newSettings);
  }

  /**
   * Export settings as JSON string
   */
  export(): string {
    return JSON.stringify(this.settings$.value, null, 2);
  }

  /**
   * Import settings from JSON string
   * Validates and migrates imported settings
   */
  import(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      const validated = validateSettings(parsed);
      this.settings$.next(validated);
      saveSettings(validated);
      return true;
    } catch (err) {
      console.error("Failed to import settings:", err);
      return false;
    }
  }
}

/**
 * Global settings manager instance
 * Import this to access settings throughout the app
 */
export const settingsManager = new SettingsManager();
