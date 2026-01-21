/**
 * React hook for accessing and updating global app settings
 */

import { useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { settingsManager, type AppSettings } from "@/services/settings";

export function useSettings() {
  const settings = use$(settingsManager.stream$);

  const updateSection = useCallback(
    <K extends keyof Omit<AppSettings, "__version">>(
      section: K,
      updates: Partial<AppSettings[K]>,
    ) => {
      settingsManager.updateSection(section, updates);
    },
    [],
  );

  const updateSetting = useCallback(
    <
      S extends keyof Omit<AppSettings, "__version">,
      K extends keyof AppSettings[S],
    >(
      section: S,
      key: K,
      value: AppSettings[S][K],
    ) => {
      settingsManager.updateSetting(section, key, value);
    },
    [],
  );

  const reset = useCallback(() => {
    settingsManager.reset();
  }, []);

  const resetSection = useCallback(
    <K extends keyof Omit<AppSettings, "__version">>(section: K) => {
      settingsManager.resetSection(section);
    },
    [],
  );

  return {
    settings,
    updateSection,
    updateSetting,
    reset,
    resetSection,
  };
}
