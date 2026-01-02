import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemeRegistration,
} from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

// Singleton highlighter instance
let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();

/**
 * Grimoire dark theme matching current minimalistic Prism styles
 * Uses muted colors with primary accent for keywords/functions
 */
const grimoireTheme: ThemeRegistration = {
  name: "grimoire-dark",
  type: "dark",
  colors: {
    "editor.background": "#000000",
    "editor.foreground": "#e5e5e5",
  },
  tokenColors: [
    // Comments - muted
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#6b7280" },
    },
    // Strings - muted but slightly emphasized
    {
      scope: ["string", "string.quoted"],
      settings: { foreground: "#9ca3af" },
    },
    // Keywords, operators - primary color
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator",
        "keyword.control",
      ],
      settings: { foreground: "#a855f7" },
    },
    // Functions, methods - primary bold
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#a855f7", fontStyle: "bold" },
    },
    // Classes, types - primary bold
    {
      scope: [
        "entity.name.class",
        "entity.name.type",
        "support.class",
        "support.type",
      ],
      settings: { foreground: "#a855f7", fontStyle: "bold" },
    },
    // Numbers, constants - primary
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
      ],
      settings: { foreground: "#a855f7" },
    },
    // Variables, parameters - foreground
    {
      scope: ["variable", "variable.parameter", "variable.other"],
      settings: { foreground: "#e5e5e5" },
    },
    // Punctuation - slightly muted
    {
      scope: ["punctuation", "meta.brace"],
      settings: { foreground: "#b3b3b3" },
    },
    // Properties, attributes
    {
      scope: [
        "variable.other.property",
        "entity.other.attribute-name",
        "support.type.property-name",
      ],
      settings: { foreground: "#d4d4d4" },
    },
    // Tags (HTML/JSX)
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#a855f7" },
    },
    // JSON keys
    {
      scope: ["support.type.property-name.json"],
      settings: { foreground: "#d4d4d4" },
    },
    // Diff - deleted (red)
    {
      scope: [
        "markup.deleted",
        "punctuation.definition.deleted",
        "meta.diff.header.from-file",
      ],
      settings: { foreground: "#ff8787" },
    },
    // Diff - inserted (green)
    {
      scope: [
        "markup.inserted",
        "punctuation.definition.inserted",
        "meta.diff.header.to-file",
      ],
      settings: { foreground: "#69db7c" },
    },
    // Diff - changed/range
    {
      scope: ["markup.changed", "meta.diff.range", "meta.diff.header"],
      settings: { foreground: "#66d9ef" },
    },
    // Markdown headings
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#a855f7", fontStyle: "bold" },
    },
    // Markdown bold/italic
    {
      scope: ["markup.bold"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["markup.italic"],
      settings: { fontStyle: "italic" },
    },
    // Markdown links
    {
      scope: ["markup.underline.link"],
      settings: { foreground: "#a855f7" },
    },
  ],
};

/**
 * Language alias mapping (file extensions and common names to Shiki IDs)
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  // JavaScript family
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  // Python
  py: "python",
  pyw: "python",
  // Ruby
  rb: "ruby",
  // Rust
  rs: "rust",
  // Go
  go: "go",
  // Shell
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  fish: "fish",
  // Config/Data
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  // JSON
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  // Markdown
  md: "markdown",
  mdx: "mdx",
  // CSS
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  // HTML/XML
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  // SQL
  sql: "sql",
  // C family
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  // C#
  cs: "csharp",
  csharp: "csharp",
  // Java/JVM
  java: "java",
  kt: "kotlin",
  kotlin: "kotlin",
  scala: "scala",
  groovy: "groovy",
  // Apple
  swift: "swift",
  objc: "objective-c",
  // PHP
  php: "php",
  // Lua
  lua: "lua",
  // Vim
  vim: "viml",
  // Docker
  dockerfile: "dockerfile",
  docker: "dockerfile",
  // Make
  makefile: "makefile",
  make: "makefile",
  // Diff/Patch
  diff: "diff",
  patch: "diff",
  // Blockchain
  sol: "solidity",
  solidity: "solidity",
  // Zig
  zig: "zig",
  // Functional
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  clj: "clojure",
  cljs: "clojure",
  // GraphQL
  graphql: "graphql",
  gql: "graphql",
  // Protocol Buffers
  proto: "protobuf",
  // Nix
  nix: "nix",
  // Terraform
  tf: "hcl",
  hcl: "hcl",
  // PowerShell
  ps1: "powershell",
  psm1: "powershell",
  // R
  r: "r",
  // Perl
  pl: "perl",
  pm: "perl",
  // LaTeX
  tex: "latex",
  latex: "latex",
  // WASM
  wat: "wasm",
  wasm: "wasm",
};

/**
 * Core languages to preload (most commonly used in Grimoire)
 */
const CORE_LANGUAGES = [
  "javascript",
  "typescript",
  "json",
  "diff",
  "bash",
] as const;

/**
 * Normalize language identifier to Shiki language ID
 */
export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return "text";
  const normalized = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[normalized] || normalized;
}

/**
 * Get or create the singleton highlighter instance
 */
export async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;

  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [grimoireTheme],
      langs: [
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/bash.mjs"),
      ],
      engine: createOnigurumaEngine(import("shiki/wasm")),
    }).then((hl) => {
      highlighter = hl;
      CORE_LANGUAGES.forEach((l) => loadedLanguages.add(l));
      return hl;
    });
  }

  return highlighterPromise;
}

/**
 * Load a language on demand
 */
async function loadLanguage(lang: string): Promise<boolean> {
  if (lang === "text" || loadedLanguages.has(lang)) return true;

  const hl = await getHighlighter();

  try {
    // Dynamic import for the language
    const langModule = await import(`shiki/langs/${lang}.mjs`);
    await hl.loadLanguage(langModule.default || langModule);
    loadedLanguages.add(lang);
    return true;
  } catch {
    // Language not available
    console.warn(
      `[shiki] Language "${lang}" not available, falling back to plaintext`,
    );
    return false;
  }
}

/**
 * Highlight code with lazy language loading
 * Returns HTML string
 */
export async function highlightCode(
  code: string,
  language: string | null | undefined,
): Promise<string> {
  const lang = normalizeLanguage(language);
  const hl = await getHighlighter();

  // Try to load the language if not already loaded
  const loaded = await loadLanguage(lang);
  const effectiveLang = loaded ? lang : "text";

  return hl.codeToHtml(code, {
    lang: effectiveLang,
    theme: "grimoire-dark",
  });
}

/**
 * Check if a language is loaded
 */
export function isLanguageLoaded(lang: string): boolean {
  return loadedLanguages.has(normalizeLanguage(lang));
}

/**
 * Preload languages (e.g., before rendering known content)
 */
export async function preloadLanguages(langs: string[]): Promise<void> {
  await getHighlighter();
  await Promise.all(langs.map((l) => loadLanguage(normalizeLanguage(l))));
}
