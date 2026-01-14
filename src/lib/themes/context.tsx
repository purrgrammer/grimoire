import * as React from "react";
import type { Theme, BuiltinThemeId } from "./types";
import { isBuiltinTheme } from "./types";
import { builtinThemes, builtinThemeList } from "./builtin";
import { applyTheme } from "./apply";

const STORAGE_KEY = "grimoire-theme";
const DEFAULT_THEME_ID: BuiltinThemeId = "dark";

interface ThemeContextValue {
  /** Current active theme */
  theme: Theme;
  /** Current theme ID */
  themeId: string;
  /** Set theme by ID */
  setTheme: (id: string) => void;
  /** List of all available themes (builtin + custom) */
  availableThemes: Theme[];
  /** Custom themes added by user */
  customThemes: Theme[];
  /** Add a custom theme */
  addCustomTheme: (theme: Theme) => void;
  /** Remove a custom theme by ID */
  removeCustomTheme: (id: string) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/**
 * Hook to access theme context
 * Must be used within a ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

/**
 * Get the saved theme ID from localStorage
 */
function getSavedThemeId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      return data.themeId || DEFAULT_THEME_ID;
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_THEME_ID;
}

/**
 * Get saved custom themes from localStorage
 */
function getSavedCustomThemes(): Theme[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      return data.customThemes || [];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Save theme data to localStorage
 */
function saveThemeData(themeId: string, customThemes: Theme[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ themeId, customThemes }),
    );
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

/**
 * Find a theme by ID from builtin and custom themes
 */
function findTheme(id: string, customThemes: Theme[]): Theme | undefined {
  if (isBuiltinTheme(id)) {
    return builtinThemes[id];
  }
  return customThemes.find((t) => t.id === id);
}

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Default theme ID (overrides localStorage on first render) */
  defaultTheme?: string;
}

/**
 * Theme provider component
 * Manages theme state, persistence, and CSS variable application
 */
export function ThemeProvider({
  children,
  defaultTheme,
}: ThemeProviderProps): React.ReactElement {
  // Initialize from localStorage or default
  const [themeId, setThemeIdState] = React.useState<string>(() => {
    return defaultTheme || getSavedThemeId();
  });

  const [customThemes, setCustomThemes] = React.useState<Theme[]>(() => {
    return getSavedCustomThemes();
  });

  // Resolve current theme
  const theme = React.useMemo(() => {
    return findTheme(themeId, customThemes) || builtinThemes[DEFAULT_THEME_ID];
  }, [themeId, customThemes]);

  // Apply theme on mount and when theme changes
  React.useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Save to localStorage when theme changes
  React.useEffect(() => {
    saveThemeData(themeId, customThemes);
  }, [themeId, customThemes]);

  const setTheme = React.useCallback((id: string) => {
    setThemeIdState(id);
  }, []);

  const addCustomTheme = React.useCallback((newTheme: Theme) => {
    setCustomThemes((prev) => {
      // Replace if exists, otherwise add
      const existing = prev.findIndex((t) => t.id === newTheme.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = newTheme;
        return updated;
      }
      return [...prev, newTheme];
    });
  }, []);

  const removeCustomTheme = React.useCallback(
    (id: string) => {
      setCustomThemes((prev) => prev.filter((t) => t.id !== id));
      // If removing current theme, switch to default
      if (themeId === id) {
        setThemeIdState(DEFAULT_THEME_ID);
      }
    },
    [themeId],
  );

  const availableThemes = React.useMemo(() => {
    return [...builtinThemeList, ...customThemes];
  }, [customThemes]);

  const contextValue = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeId,
      setTheme,
      availableThemes,
      customThemes,
      addCustomTheme,
      removeCustomTheme,
    }),
    [
      theme,
      themeId,
      setTheme,
      availableThemes,
      customThemes,
      addCustomTheme,
      removeCustomTheme,
    ],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
