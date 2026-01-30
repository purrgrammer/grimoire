/**
 * React hook for accessing and updating global app settings
 */

import { useCallback } from "react";
import { use$ } from "applesauce-react/hooks";
import { settingsManager, type AppSettings } from "@/services/settings";

export function useSettings() {
  const settings = use$(settingsManager.stream$);

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

  return {
    settings,
    updateSetting,
    reset,
  };
}
