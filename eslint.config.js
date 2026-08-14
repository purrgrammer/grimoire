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

      // applesauce v6: pool.subscription() defaults to a throwaway event store,
      // so omitting options silently drops events. See CLAUDE.md.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'CallExpression[callee.object.name="pool"][callee.property.name=/^(subscription|request)$/][arguments.length<3]',
          message:
            "pool.subscription()/pool.request() need an options argument: pass { eventStore } so events reach the shared store (applesauce defaults to a throwaway one). For an EOSE signal use streamWithEose(), and for one-shot fetches requestEvents()/requestEvent(), from @/lib/relay-subscription.",
        },
        {
          // applesauce turns `true` into repeat({ delay: () => of(null) }) — a
          // synchronous loop, measured at >20k REQ frames/sec against a relay
          // that CLOSEs after EOSE.
          selector: 'Property[key.name="resubscribe"][value.value=true]',
          message:
            "resubscribe: true has no backoff and floods relays that close after EOSE. Pass a delay instead, e.g. { delay: 5000 }.",
        },
        {
          // Vite cannot statically analyse these: it warns, never emits the
          // chunk, and the import fails in production while working in dev.
          selector: 'ImportExpression > TemplateLiteral[expressions.length>0]',
          message:
            "Vite cannot analyse a template-literal dynamic import, so the chunk is never bundled and it fails in production. Use the library's own lazy registry or import.meta.glob.",
        },
        {
          // A Concord plane REQ is authored by DERIVED stream keys, never the
          // user, so applesauce's auth handling is actively wrong for it: with
          // waitForAuth on it either deadlocks or resubscribes at round-trip
          // speed (~17k REQ/s, measured), and requestEvents() swallows the
          // auth-required CLOSED into an empty array, so the sweep cannot tell
          // a gated plane from an absent one. Both failures are silent.
          selector:
            'Property[key.name="waitForAuth"][value.value=true], Property[key.name="waitForAuth"][value.type="Identifier"]',
          message:
            "Concord plane reads must keep waitForAuth: false — applesauce re-authenticates as the USER, which never satisfies a stream-authored filter. Go through planeRequest() in @/lib/concord/plane-request.",
        },
      ],

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
