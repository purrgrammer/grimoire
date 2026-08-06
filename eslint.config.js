import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // .agents holds vendored agent skills (installed via `npx skills add`);
  // .claude holds agent config and git worktrees. Neither is our source.
  { ignores: ["dist", "node_modules", ".claude", ".agents"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      prettier: prettier,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "prettier/prettier": "error",

      // --- Rules newly promoted to error by eslint 10 / react-hooks 7 ---
      // These flag real issues in pre-existing code, but fixing them all is a
      // separate refactor (~140 sites). Kept at "warn" so the signal stays
      // visible without breaking the lint gate. Promote to "error" per-rule as
      // each backlog is cleared.
      //
      // eslint 10 moved these into js.configs.recommended:
      "preserve-caught-error": "warn", // rethrow without `{ cause }`
      "no-useless-assignment": "warn",
      // react-hooks 7 ships the React Compiler rule set in `recommended`:
      "react-hooks/error-boundaries": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  prettierConfig,
);
