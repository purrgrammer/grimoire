import { useEffect, useRef } from "react";
import Prism from "prismjs";

// Core languages
import "prismjs/components/prism-diff";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-css";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";

interface SyntaxHighlightProps {
  code: string;
  language:
    | "diff"
    | "javascript"
    | "typescript"
    | "jsx"
    | "tsx"
    | "bash"
    | "shell"
    | "json"
    | "markdown"
    | "css"
    | "python"
    | "yaml";
  className?: string;
  showLineNumbers?: boolean;
}

/**
 * Syntax highlighting component using Prism.js
 * Matches Grimoire's dark theme using CSS custom properties
 *
 * @example
 * ```tsx
 * <SyntaxHighlight code={patchContent} language="diff" />
 * ```
 */
export function SyntaxHighlight({
  code,
  language,
  className = "",
  showLineNumbers = false,
}: SyntaxHighlightProps) {
  const codeRef = useRef<HTMLElement>(null);

  // Normalize language aliases
  const normalizedLanguage = language === "shell" ? "bash" : language;

  useEffect(() => {
    // Check for browser environment (SSR safety)
    if (typeof window === "undefined" || !codeRef.current) return;

    // Highlight the code element
    Prism.highlightElement(codeRef.current);
  }, [code, normalizedLanguage]);

  return (
    <pre
      className={`language-${normalizedLanguage} ${showLineNumbers ? "line-numbers" : ""} ${className}`.trim()}
    >
      <code ref={codeRef} className={`language-${normalizedLanguage}`}>
        {code}
      </code>
    </pre>
  );
}
