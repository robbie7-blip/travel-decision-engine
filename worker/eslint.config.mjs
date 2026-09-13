// The worker's linter, which did not exist at all - not even a broken
// script to run. The frontend at least had `eslint .` failing on a missing
// config; this package had nothing.
//
// Which is the wrong way round, because this is the half where an
// unhandled promise is fatal. The process runs WORKER_CONCURRENCY jobs at
// once, `uncaughtException` is deliberately left alone (see the comment on
// it in index.ts), and a rejected promise nobody observed is how one
// traveller's failure takes down three other generations in flight. This
// session alone needed `.catch(() => {})` added by hand twice - on the
// frame promise and on the per-day verification - each time because
// nothing awaited them in the window where they could reject, and each
// time found by reading rather than by a tool.
//
// Same discipline as the frontend config: the rules that map onto defects
// THIS code has shipped, all of them errors, no stylistic opinions. A
// linter's failure mode is being switched off, and the way that happens is
// a first run with three hundred findings about quote style.

import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const config = [
  {
    ignores: ["node_modules/**", "dist/**", "facts/**"],
  },

  js.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // The TypeScript program, which the promise rules need to tell a
        // real promise from an object that happens to have a .then.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        // Node. Declared explicitly rather than pulled from a globals
        // package: this is the whole set this worker actually touches, and
        // a short list is a list somebody reads.
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        Buffer: "readonly",
        crypto: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // js.configs.recommended flags these on TypeScript in ways the
      // compiler already covers better.
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",

      // --- the ones that are fatal here ---------------------------------
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",

      // --- the ones that find drift -------------------------------------
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",

      // --- the ones that encode a defect this product shipped -----------
      // `costEstimateEur != null` is what let a NaN into the lodging cache
      // and priced a night at EURNaN. "smart" keeps the deliberate
      // `x == null` null-ish check and refuses every other loose compare.
      eqeqeq: ["error", "smart"],
      "no-self-compare": "error",
      // The globals coerce: isNaN("") is false and isNaN({}) is true. Every
      // guard in this pipeline that matters uses the Number.* form, and the
      // ones that did not are the bugs this session fixed.
      "no-restricted-globals": [
        "error",
        { name: "isNaN", message: "Use Number.isNaN - the global coerces, so isNaN('') is false." },
        { name: "isFinite", message: "Use Number.isFinite - the global coerces." },
      ],
      // `for (;;)` is the consumer loop and is deliberate; a constant
      // condition anywhere else is a mistake.
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  {
    // The homegrown suites: scripts run by tsx, where console output IS the
    // result and a deliberately-malformed fixture is the whole point.
    files: ["**/*.test.ts", "src/testutil.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-shadow": "off",
    },
  },
];

export default config;
