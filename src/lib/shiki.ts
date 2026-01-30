import {
  createHighlighterCore,
  type HighlighterCore,
  type ShikiTransformer,
} from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

// Singleton highlighter instance
let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();
const failedLanguages = new Set<string>();

/**
 * Transformer that adds CSS classes based on token scopes
 * This allows us to style tokens with CSS variables instead of inline colors
 */
const classTransformer: ShikiTransformer = {
  name: "class-transformer",
  span(node) {
    // Map inline colors to semantic CSS classes
    // This allows us to style tokens with CSS variables instead of hardcoded colors
    const style = node.properties?.style as string | undefined;
    if (!style) return;

    // Remove inline style and add class based on token type
    delete node.properties.style;

    // Add base class
    node.properties.className = node.properties.className || [];
    const classes = node.properties.className as string[];
    classes.push("shiki-token");

    // Detect token type from the original style color
    // These colors come from our theme definitions
    if (style.includes("#8b949e") || style.includes("comment")) {
      classes.push("shiki-comment");
    } else if (style.includes("#a5d6ff") || style.includes("string")) {
      classes.push("shiki-string");
    } else if (style.includes("#79c0ff") || style.includes("constant")) {
      classes.push("shiki-constant");
    } else if (style.includes("#7ee787") || style.includes("tag")) {
      classes.push("shiki-tag");
    } else if (style.includes("#ffa198") || style.includes("deleted")) {
      classes.push("shiki-deleted");
    } else if (
      style.includes("#f0f0f0") ||
      style.includes("#e6edf3") ||
      style.includes("keyword") ||
      style.includes("function")
    ) {
      classes.push("shiki-keyword");
    } else if (style.includes("#c9d1d9") || style.includes("punctuation")) {
      classes.push("shiki-punctuation");
    }
  },
  pre(node) {
    // Remove background color from pre, let CSS handle it
    if (node.properties?.style) {
      const style = node.properties.style as string;
      node.properties.style = style.replace(/background-color:[^;]+;?/g, "");
    }
  },
  code(node) {
    // Remove color from code element
    if (node.properties?.style) {
      delete node.properties.style;
    }
  },
};

/**
 * Minimal theme - we'll override colors via CSS
 * Using high-contrast colors as fallback if CSS fails
 */
const minimalTheme = {
  name: "grimoire",
  type: "dark" as const,
  colors: {
    "editor.background": "transparent",
    "editor.foreground": "#e6edf3",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#8b949e" },
    },
    {
      scope: ["string", "string.quoted"],
      settings: { foreground: "#a5d6ff" },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator",
        "keyword.control",
      ],
      settings: { foreground: "#f0f0f0" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#e6edf3" },
    },
    {
      scope: [
        "entity.name.class",
        "entity.name.type",
        "support.class",
        "support.type",
      ],
      settings: { foreground: "#f0f0f0" },
    },
    {
      scope: [
        "constant",
        "constant.numeric",
        "constant.language",
        "constant.character",
      ],
      settings: { foreground: "#79c0ff" },
    },
    {
      scope: ["variable", "variable.parameter", "variable.other"],
      settings: { foreground: "#e6edf3" },
    },
    {
      scope: ["punctuation", "meta.brace"],
      settings: { foreground: "#c9d1d9" },
    },
    {
      scope: [
        "variable.other.property",
        "entity.other.attribute-name",
        "support.type.property-name",
      ],
      settings: { foreground: "#e6edf3" },
    },
    {
      scope: ["entity.name.tag", "support.class.component"],
      settings: { foreground: "#7ee787" },
    },
    {
      scope: ["support.type.property-name.json"],
      settings: { foreground: "#a5d6ff" },
    },
    {
      scope: [
        "markup.deleted",
        "punctuation.definition.deleted",
        "meta.diff.header.from-file",
      ],
      settings: { foreground: "#ffa198" },
    },
    {
      scope: [
        "markup.inserted",
        "punctuation.definition.inserted",
        "meta.diff.header.to-file",
      ],
      settings: { foreground: "#7ee787" },
    },
    {
      scope: ["markup.changed", "meta.diff.range", "meta.diff.header"],
      settings: { foreground: "#a5d6ff" },
    },
    {
      scope: ["markup.heading", "entity.name.section"],
      settings: { foreground: "#f0f0f0" },
    },
    {
      scope: ["markup.bold"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["markup.italic"],
      settings: { fontStyle: "italic" },
    },
    {
      scope: ["markup.underline.link"],
      settings: { foreground: "#a5d6ff" },
    },
    {
      scope: ["markup.inline.raw", "markup.raw"],
      settings: { foreground: "#a5d6ff" },
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
  "rust",
  "markdown",
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
      themes: [minimalTheme],
      langs: [
        import("shiki/langs/javascript.mjs"),
        import("shiki/langs/typescript.mjs"),
        import("shiki/langs/json.mjs"),
        import("shiki/langs/diff.mjs"),
        import("shiki/langs/bash.mjs"),
        import("shiki/langs/rust.mjs"),
        import("shiki/langs/markdown.mjs"),
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
  if (failedLanguages.has(lang)) return false;

  const hl = await getHighlighter();

  try {
    // Dynamic import for the language
    const langModule = await import(`shiki/langs/${lang}.mjs`);
    await hl.loadLanguage(langModule.default || langModule);
    loadedLanguages.add(lang);
    return true;
  } catch {
    // Language not available - track to avoid repeated warnings
    failedLanguages.add(lang);
    console.warn(
      `[shiki] Language "${lang}" not available, falling back to plaintext`,
    );
    return false;
  }
}

/**
 * Highlight code with lazy language loading
 * Returns HTML string with CSS classes for styling via CSS variables
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
    theme: "grimoire",
    transformers: [classTransformer],
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
