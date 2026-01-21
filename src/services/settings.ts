/**
 * Global application settings
 * Manages user preferences with localStorage persistence
 */

import { BehaviorSubject } from "rxjs";

export interface AppSettings {
  /** Whether to include client tag in published events */
  includeClientTag: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  includeClientTag: true,
};

const SETTINGS_STORAGE_KEY = "grimoire-settings";

/**
 * Load settings from localStorage with error handling
 */
function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
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

/**
 * Global settings manager
 * Use settings$ to reactively observe settings changes
 * Use getSetting() for non-reactive access
 * Use updateSetting() to update a setting
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
   * Get a specific setting value
   */
  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings$.value[key];
  }

  /**
   * Update a specific setting
   * Automatically persists to localStorage
   */
  updateSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ): void {
    const newSettings = { ...this.settings$.value, [key]: value };
    this.settings$.next(newSettings);
    saveSettings(newSettings);
  }

  /**
   * Update multiple settings at once
   * Automatically persists to localStorage
   */
  updateSettings(updates: Partial<AppSettings>): void {
    const newSettings = { ...this.settings$.value, ...updates };
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
 * Import this to access settings throughout the app
 */
export const settingsManager = new SettingsManager();
