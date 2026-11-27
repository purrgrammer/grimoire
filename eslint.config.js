import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";

/**
 * Relay and bundling invariants the compiler cannot see. Every entry here
 * corresponds to a bug that shipped green, so these apply everywhere —
 * application code AND tests.
 */
// body pads itself by the safe-area insets (src/index.css), so a shell sized
// to the whole viewport overflows by the system bars. On the Android app with
// WebView >= 140 that pushed the tab bar under the navigation bar. h-app is
// the viewport minus that padding.
const viewportHeightSyntaxRules = [
  {
    selector: "Literal[value=/(^|\\s)h-(dvh|screen)(\\s|$)/]",
    message:
      "h-dvh/h-screen overflow by the body's safe-area padding and hide the tab bar on edge-to-edge Android. Use h-app (src/index.css).",
  },
];

const relaySyntaxRules = [
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
    selector: "ImportExpression > TemplateLiteral[expressions.length>0]",
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
  {
    // Kehto's prelude injector finds its insertion point by string-matching
    // a policy meta. A decoy meta hidden in an attribute on <html> survives
    // our DOM pass (attribute serialization does not escape `<`), so
    // anything that runs after us matches the decoy, splices into the
    // attribute value, and the real policy ends up in <body> where it does
    // nothing. Shipped exactly that way once.
    // Narrow to injector wrappers: reading the result, e.g. in a test, is
    // fine — only *writing more document around it* is the hazard.
    selector:
      'CallExpression[callee.name=/^inject/] > CallExpression[callee.name="injectCspMeta"]',
    message:
      "injectCspMeta must be the outermost injection: anything applied after it can displace the policy out of <head>, and the document then ships with no CSP.",
  },
];

/**
 * Blocked-relay enforcement, kept out of test files.
 *
 * A test constructs a plain `RelayPool` and reaches single relays by name on
 * purpose — it is testing the transport, not the user's block list, and making
 * tests depend on global blocked state would make them order-dependent.
 */
const blockedRelaySyntaxRules = [
  {
    // Every multi-relay op in applesauce funnels through group(), so
    // BlockingRelayPool.group() is the ONE place the NIP-51 kind-10006
    // blocked list is enforced. `pool.relay(url)` goes straight past it
    // and also REGISTERS the relay, which drags liveness and the auth
    // manager along. The guarded callers each carry an eslint-disable
    // naming their reason.
    selector: 'CallExpression[callee.property.name="relay"]',
    message:
      "Direct pool.relay() bypasses BlockingRelayPool.group(), the single chokepoint enforcing the kind-10006 blocked relay list. Use pool.req/subscription/request/publish, or check isRelayBlocked() from @/services/blocked-relays first and add an eslint-disable saying so.",
  },
  {
    // A plain RelayPool honours no block list. There are five pools in
    // this tree and every one of them must be a BlockingRelayPool.
    selector: 'NewExpression[callee.name="RelayPool"]',
    message:
      "Use BlockingRelayPool from @/services/blocking-relay-pool: a plain RelayPool ignores the kind-10006 blocked relay list, so anything reading through it can reach relays the user blocked.",
  },
];

/**
 * An `import()` written inline, inside a function, hides a module load
 * behind whatever that function is for. In a test it put the whole kinds
 * registry inside one case's 5s budget and timed out on a cold run; in
 * application code it is a code split nobody decided on. The decided forms
 * are allowed: the body of `lazy(() => import(...))`, a `vi.mock` or
 * `vi.hoisted` factory (which must import dynamically, being hoisted), a
 * loader thunk whose whole body is the import (`() => import("x")`, which
 * is how a lazy registry such as shiki's grammars is written), and the top
 * level of a test file after its mocks. A deliberate code split anywhere
 * else carries an eslint-disable naming its reason, the same way the
 * guarded `pool.relay()` callers do.
 */
const noInlineDynamicImport = {
  meta: {
    type: "problem",
    docs: { description: "disallow import() outside the sanctioned forms" },
    messages: {
      inline:
        "Inline import(): use a static import, a loader thunk `() => import(...)`, or `lazy(() => import(...))` for a component. A deliberate code split needs an eslint-disable-next-line naming what it keeps out of the entry bundle, or the cycle it breaks.",
    },
    schema: [],
  },
  create(context) {
    const isTest = /\.test\.[jt]sx?$/.test(context.filename);
    const calleeName = (call) => {
      const c = call.callee;
      if (c.type === "Identifier") return c.name;
      if (c.type === "MemberExpression" && c.property.type === "Identifier") {
        const obj = c.object.type === "Identifier" ? c.object.name : "";
        return `${obj}.${c.property.name}`;
      }
      return "";
    };
    const isFunction = (n) =>
      n.type === "ArrowFunctionExpression" ||
      n.type === "FunctionExpression" ||
      n.type === "FunctionDeclaration";
    return {
      ImportExpression(node) {
        // A thunk: the import is the arrow's whole body, or the only
        // statement of the function is `return import(...)`.
        const p = node.parent;
        if (p?.type === "ArrowFunctionExpression" && p.body === node) return;
        if (
          p?.type === "ReturnStatement" &&
          p.parent?.type === "BlockStatement" &&
          p.parent.body.length === 1 &&
          isFunction(p.parent.parent)
        ) {
          return;
        }
        let parent = node.parent;
        let insideFunction = false;
        while (parent) {
          if (isFunction(parent)) {
            const call = parent.parent;
            if (
              call?.type === "CallExpression" &&
              call.arguments[0] === parent
            ) {
              const name = calleeName(call);
              if (name === "lazy" || name === "React.lazy") return;
            }
            insideFunction = true;
          }
          if (parent.type === "CallExpression") {
            const name = calleeName(parent);
            if (/^vi\.(mock|doMock|hoisted)$/.test(name)) return;
          }
          parent = parent.parent;
        }
        if (isTest && !insideFunction) return;
        context.report({ node, messageId: "inline" });
      },
    };
  },
};

export default tseslint.config(
  // .agents holds vendored agent skills (installed via `npx skills add`);
  // .claude holds agent config and git worktrees. Neither is our source.
  // android/ is the Capacitor project: Java, Gradle and, after a sync, a
  // copy of dist/ plus Capacitor's generated bridge — none of it source here.
  { ignores: ["dist", "node_modules", ".claude", ".agents", "android"] },
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
      grimoire: {
        rules: { "no-inline-dynamic-import": noInlineDynamicImport },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "grimoire/no-inline-dynamic-import": "error",
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

      // Invariants the compiler cannot see, each one from a bug that shipped.
      // See relaySyntaxRules and blockedRelaySyntaxRules above.
      "no-restricted-syntax": ["error", ...relaySyntaxRules],

      // The whole containment argument for a pre-1.0 dependency is that a
      // breaking change lands in one file. It leaked to five before this rule
      // existed. Type-only imports are exempt below — they are erased at build
      // and a breaking type change fails tsc loudly.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@kehto/*", "@napplet/*"],
              importNames: undefined,
              allowTypeImports: true,
              message:
                "Import Kehto only through src/services/kehto.ts, the single seam. Add what you need to its re-exports.",
            },
          ],
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
  {
    // The seam itself, and the tests that pin our constants to Kehto's.
    files: ["src/services/kehto.ts", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Application code only — see blockedRelaySyntaxRules above.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "src/test/**"],
    // Both arrays, not just the blocked-relay ones: a later flat-config
    // object REPLACES a rule's entire options array, so listing only the new
    // entries here silently disabled all five relaySyntaxRules in every
    // application file — and a disabled rule reports zero errors.
    rules: {
      "no-restricted-syntax": [
        "error",
        ...relaySyntaxRules,
        ...blockedRelaySyntaxRules,
        ...viewportHeightSyntaxRules,
      ],
    },
  },
  prettierConfig,
);
