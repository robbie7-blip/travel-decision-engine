// The site's absolute base URL - which is in the auth and payment paths,
// not just in page metadata.
//
// siteUrl.ts's own header used to describe it as being for metadataBase,
// sitemap.ts and robots.ts. It is also what builds:
//
//   - the MAGIC-LINK SIGN-IN URL that gets emailed, and the redirects the
//     verify route issues;
//   - every share link handed back by api/visited/share;
//   - Stripe's checkout success/cancel URLs and the billing portal's
//     return_url.
//
// So a wrong value is a sign-in email nobody can use, with a token that
// expires in fifteen minutes, and a customer who finishes paying and lands
// nowhere.
//
// And it failed silently: with neither Vercel variable set it returned
// "http://localhost:3000" with nothing overriding it and nothing logged.
// On Vercel the variables are injected, so it worked - but nothing in the
// code made that a requirement, and there was no way to pin the real custom
// domain, which is the one that has to match the cookie the session is set
// on.
//
// Run: npm run test:site-url

import { getSiteUrl } from "./siteUrl";
import { check, finish, heading, section } from "./testutil";

heading("site base URL");

const VARS = ["SITE_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL", "NODE_ENV"] as const;

/** Runs getSiteUrl with exactly this environment. */
function withEnv(env: Partial<Record<(typeof VARS)[number], string>>): string {
  const saved: Record<string, string | undefined> = {};
  for (const key of VARS) {
    saved[key] = process.env[key];
    // NODE_ENV is typed read-only by Next.js; this suite has to vary it.
    const bag = process.env as Record<string, string | undefined>;
    if (env[key] === undefined) delete bag[key];
    else bag[key] = env[key];
  }
  try {
    return getSiteUrl();
  } finally {
    for (const key of VARS) {
      const bag = process.env as Record<string, string | undefined>;
      if (saved[key] === undefined) delete bag[key];
      else bag[key] = saved[key];
    }
  }
}

function main() {
  section("an explicit SITE_URL wins");

  {
    // The reason it has to win: Vercel's idea of "the production domain" is
    // not necessarily the domain the product is served on, and the emailed
    // sign-in link must match the host whose cookie the session is set on.
    check(
      "SITE_URL beats both Vercel variables",
      withEnv({
        SITE_URL: "https://yourdecide.com",
        VERCEL_PROJECT_PRODUCTION_URL: "decide.vercel.app",
        VERCEL_URL: "decide-abc123.vercel.app",
      }) === "https://yourdecide.com"
    );
  }

  {
    // These values are concatenated with paths - `${site}/api/auth/verify` -
    // so a trailing slash produces "//api/auth/verify".
    check("a trailing slash is removed", withEnv({ SITE_URL: "https://yourdecide.com/" }) === "https://yourdecide.com");
    check("a path is discarded", withEnv({ SITE_URL: "https://yourdecide.com/app" }) === "https://yourdecide.com");
    check("a port is kept", withEnv({ SITE_URL: "http://localhost:4000" }) === "http://localhost:4000");
    check("whitespace is trimmed", withEnv({ SITE_URL: "  https://yourdecide.com  " }) === "https://yourdecide.com");
  }

  {
    // A bare hostname is not an absolute URL: concatenated with a path it
    // silently resolves against whatever page is open, so an emailed link
    // built from it would not be a link at all.
    check("a bare hostname is refused", withEnv({ SITE_URL: "yourdecide.com", VERCEL_URL: "d.vercel.app" }) === "https://d.vercel.app");
    check("an empty SITE_URL falls through", withEnv({ SITE_URL: "", VERCEL_URL: "d.vercel.app" }) === "https://d.vercel.app");
    check("whitespace-only falls through", withEnv({ SITE_URL: "   ", VERCEL_URL: "d.vercel.app" }) === "https://d.vercel.app");
    check("a non-http scheme is refused", withEnv({ SITE_URL: "ftp://yourdecide.com", VERCEL_URL: "d.vercel.app" }) === "https://d.vercel.app");
    check("javascript: is refused", withEnv({ SITE_URL: "javascript:alert(1)", VERCEL_URL: "d.vercel.app" }) === "https://d.vercel.app");
  }

  section("the Vercel variables, in order");

  {
    // Production before the deployment's own URL, so a preview build still
    // generates links pointing at production rather than at itself.
    check(
      "the production domain beats the deployment URL",
      withEnv({ VERCEL_PROJECT_PRODUCTION_URL: "decide.vercel.app", VERCEL_URL: "decide-abc123.vercel.app" }) ===
        "https://decide.vercel.app"
    );
    check(
      "the deployment URL is used when there is no production domain",
      withEnv({ VERCEL_URL: "decide-abc123.vercel.app" }) === "https://decide-abc123.vercel.app"
    );
  }

  {
    // Vercel supplies a bare host, not a URL - the https:// is added here,
    // and a value that already carries one must not become "https://https://".
    check(
      "a Vercel value that already has a scheme does not double it",
      !withEnv({ VERCEL_URL: "https://decide.vercel.app" }).includes("https://https")
    );
  }

  section("the localhost fallback");

  {
    check("development falls back to localhost", withEnv({ NODE_ENV: "development" }) === "http://localhost:3000");
  }

  {
    // The silent failure this replaces. It still returns localhost - there
    // is nothing better to return - but in production it now says so, once
    // per process, naming sign-in and checkout as the things that are
    // broken. A message in the logs is the difference between an afternoon
    // and a week.
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.join(" "));
    try {
      withEnv({ NODE_ENV: "production" });
    } finally {
      console.error = original;
    }
    check("production with nothing set still returns something usable", withEnv({ NODE_ENV: "development" }) === "http://localhost:3000");
    check("and warns", errors.length === 1, JSON.stringify(errors));
    check("naming SITE_URL as the fix", errors[0]?.includes("Set SITE_URL"), errors[0]);
    check("and naming what is broken", /sign-in and checkout/.test(errors[0] ?? ""), errors[0]);
  }

  finish();
}

main();
