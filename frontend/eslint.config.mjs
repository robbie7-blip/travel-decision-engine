// The linter, which until now did not run at all.
//
// `npm run lint` has been `eslint .` since the project was created, with no
// config file anywhere - so it exited on ESLint 9's "couldn't find a
// configuration file" and checkCiScripts.mjs excused it in NOT_IN_CI as
// "not yet enforced". A repo with a 51-step CI and sixteen hundred
// assertions had no linter, which is the conspicuous hole: TypeScript
// checks types and nothing checked anything else.
//
// WHAT THIS IS TUNED FOR, because a linter's failure mode is being
// switched off. A default "recommended" ruleset on a codebase this size
// produces hundreds of findings, most of them style, and the honest
// response to that is to disable it - which is how a project ends up
// exactly where this one was. So the rules below are the ones that map
// onto defects THIS codebase has actually shipped, each set to error, with
// stylistic opinions left off entirely:
//
//   no-floating-promises      The worker runs four jobs at once and Node
//                             exits the process on an unhandled rejection.
//                             This session alone needed `promise.catch(()
//                             => {})` added by hand twice - on the frame
//                             promise and on the per-day verification -
//                             precisely because nothing awaited them in
//                             the window where they could reject.
//   no-misused-promises       An async function passed where a sync one is
//                             expected: the classic `onClick={async ...}`
//                             and, worse, an `if (somePromise)` that is
//                             always true.
//   eqeqeq (smart)            `!= null` was the guard that let NaN through
//                             into the lodging cache and priced a night at
//                             EURNaN. Allows the deliberate `== null`
//                             null-ish check, refuses the rest.
//   no-unused-vars            Dead code and, more usefully, the argument
//                             somebody stopped passing.
//   require-await             An async function with no await is usually a
//                             signature that drifted.
//   no-shadow                 Two `timings` in one scope is how a value
//                             gets written to the wrong object.
//
// Type-aware rules need the TypeScript program, which is why
// projectService is on. That is the slow part; it is measured in CI's own
// comment rather than assumed.

// All three are declared in package.json devDependencies rather than left
// to resolve through eslint-config-next, which is how they were installed
// here already. A transitive dependency that happens to be on disk today
// is not a dependency: one `eslint-config-next` minor that stops pulling
// @typescript-eslint through, and CI's lint step dies on a missing module
// in a repo that still passes locally.
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    // Nothing generated, vendored or built. `.next` in particular holds
    // megabytes of compiled output that would take longer to lint than the
    // whole source tree.
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "public/**",
      "next-env.d.ts",
      // Plain-JS guard scripts. They are checked by running them - each one
      // is a CI step - and they are Node scripts with no tsconfig to
      // type-check against.
      "scripts/**",
    ],
  },

  // Next's own rules: the React hooks pair (exhaustive-deps has caught real
  // stale-closure bugs in the components written this session) plus the
  // framework-specific ones about images and links.
  ...compat.extends("next/core-web-vitals"),

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // The TypeScript program, which the rules below need to know what
        // is a promise and what is merely an object with a .then.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // --- the ones that find real bugs ---------------------------------
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        // Deliberately NOT checksConditionals-only: passing an async
        // function as a void callback is the common form here (an onClick
        // that awaits, a setTimeout that awaits).
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/await-thenable": "error",

      // Escalated from the warning next/core-web-vitals ships it as,
      // because `eslint .` exits 0 on warnings - a rule at warn level is a
      // rule that does not gate. This one found a real bug on its first
      // run (CompareView's poll handler reading a stale `t`), so leaving
      // it advisory would mean the next instance of that bug scrolls past
      // in green CI. The framework's other warnings stay warnings:
      // no-img-element is a performance opinion, not a defect.
      "react-hooks/exhaustive-deps": "error",

      // --- the ones that find drift -------------------------------------
      "@typescript-eslint/no-unused-vars": [
        "error",
        // An intentionally-ignored binding is spelled with a leading
        // underscore, which this file's own `..._rest` fakes already do.
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-unused-vars": "off",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",

      // --- the ones that encode a defect this product shipped -----------
      // `!= null` let NaN through into a cached price. "smart" keeps the
      // one legitimate loose comparison (`x == null`) and refuses the rest.
      eqeqeq: ["error", "smart"],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-self-compare": "error",
      // `Number.isNaN` rather than `isNaN`: the global coerces, so
      // isNaN("") is false and isNaN({}) is true.
      "no-restricted-globals": [
        "error",
        { name: "isNaN", message: "Use Number.isNaN - the global coerces, so isNaN('') is false." },
        { name: "isFinite", message: "Use Number.isFinite - the global coerces." },
      ],
    },
  },

  {
    // Style opinions this config does not hold.
    //
    // react/no-unescaped-entities came in with next/core-web-vitals and
    // accounted for 23 of the 42 errors on the first run - every one of
    // them a straight apostrophe or quote in the privacy and terms prose,
    // all of which render correctly. Fixing them would have been 23 diffs
    // of &rsquo; in legal copy for no behavioural gain, and leaving them
    // failing would have been 23 reasons to stop reading the output. This
    // config is the rules that map onto defects this product has shipped;
    // typography in a terms page is not one of them.
    files: ["**/*.tsx"],
    rules: { "react/no-unescaped-entities": "off" },
  },

  {
    // require-await is wrong for framework entry points.
    //
    // Next.js route handlers and generateMetadata are async by convention
    // and the framework awaits their result, so an async one with no await
    // inside is correct rather than drifted - five of the first run's
    // errors were exactly that. The rule stays on for lib/ and
    // components/, where an async function with nothing to await really
    // does mean a signature that moved.
    files: ["app/**"],
    rules: { "@typescript-eslint/require-await": "off" },
  },

  {
    // The homegrown suites. They are scripts run by tsx, not modules, so
    // console output is the point and a deliberately-malformed fixture is
    // the whole test - `as never` and friends are load-bearing there.
    files: ["**/*.test.ts", "**/*.test.tsx", "lib/testutil.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
];

export default config;
