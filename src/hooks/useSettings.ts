/**
 * React hook for accessing and updating global app settings
 */

import { useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { settingsManager, type AppSettings } from "@/services/settings";

export function useSettings() {
  const settings = use$(settingsManager.stream$);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      settingsManager.updateSetting(key, value);
    },
    [],
  );

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    settingsManager.updateSettings(updates);
  }, []);

  const reset = useCallback(() => {
    settingsManager.reset();
  }, []);

  return {
    settings,
    updateSetting,
    updateSettings,
    reset,
  };
}
