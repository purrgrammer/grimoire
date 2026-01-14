// Types
export type {
  Theme,
  ThemeColors,
  ThemeSyntax,
  ThemeScrollbar,
  ThemeGradient,
  ThemeMeta,
  HSLValue,
  RGBValue,
  BuiltinThemeId,
} from "./types";
export { isBuiltinTheme } from "./types";

// Built-in themes
export {
  darkTheme,
  lightTheme,
  plan9Theme,
  builtinThemes,
  builtinThemeList,
  getBuiltinTheme,
} from "./builtin";

// Theme application
export { applyTheme, getThemeVariables } from "./apply";

// Context and hooks
export { ThemeProvider, useTheme } from "./context";
