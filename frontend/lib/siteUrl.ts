// The site's own absolute base URL.
//
// The header here used to say this was "used by the root layout
// (metadataBase) and by sitemap.ts/robots.ts". That was true once and is
// badly out of date: it now also builds
//
//   - the MAGIC-LINK SIGN-IN URL that gets emailed (api/auth/request-link)
//     and the redirects the verify route sends people to;
//   - every SHARE LINK handed back by api/visited/share;
//   - Stripe's checkout success/cancel URLs and the billing portal's
//     return_url.
//
// So a wrong value here is not a cosmetic metadata problem. It is a sign-in
// email nobody can use, with a token that expires in fifteen minutes, and a
// customer who finishes paying and lands nowhere.
//
// Which matters because of how it used to fail: with neither Vercel
// variable set it returned "http://localhost:3000" SILENTLY. Nothing
// overrode it and nothing said a word. On Vercel those variables are
// injected so it works, but nothing in the code made that a requirement,
// and the consequence of it not holding is an auth and payment outage with
// no error anywhere - just links to localhost in real emails.
//
// Hence two changes: an explicit SITE_URL always wins, so the owner can pin
// the real custom domain rather than trusting which domain Vercel decides
// is "production"; and the localhost fallback now says so loudly outside
// development instead of being indistinguishable from a working
// configuration.

/** Strips a trailing slash and rejects anything that is not an absolute
 * http(s) origin - these values are concatenated with paths like
 * `${site}/api/auth/verify`, so a trailing slash produces a double slash
 * and a bare hostname produces a relative URL that silently resolves
 * against whatever page happened to be open. */
function normalizeBase(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.protocol}//${url.host}`;
}

/** Vercel supplies a BARE HOST ("decide.vercel.app"), so the scheme is
 * added here. Guarded because the old code prefixed unconditionally: a
 * value that already carried one produced "https://https://decide.vercel.app",
 * whose parsed host is literally "https", so every link in every sign-in
 * email would have pointed at a host called https. Vercel does not do that
 * today, and one line is cheaper than depending on it never changing. */
function withScheme(host: string | undefined): string | undefined {
  const value = (host ?? "").trim();
  if (!value) return undefined;
  return value.includes("://") ? value : `https://${value}`;
}

/** Warned once per process, not once per call - this is read on every
 * request that builds a link. */
let warnedAboutLocalhost = false;

/** Vercel injects VERCEL_* automatically at build/runtime. The production
 * domain is preferred over the current deployment's own URL so a preview
 * build still generates links pointing at production rather than at
 * itself.
 *
 * SITE_URL comes first because Vercel's own choice of "the production
 * domain" is not necessarily the domain the product is actually served on,
 * and the emailed sign-in link has to match the domain whose cookie the
 * session is set on - land someone on a different host and they are signed
 * in somewhere they did not ask to be, and still signed out where they
 * were. */
export function getSiteUrl(): string {
  const explicit = normalizeBase(process.env.SITE_URL);
  if (explicit) return explicit;

  const production = normalizeBase(withScheme(process.env.VERCEL_PROJECT_PRODUCTION_URL));
  if (production) return production;

  const deployment = normalizeBase(withScheme(process.env.VERCEL_URL));
  if (deployment) return deployment;

  if (process.env.NODE_ENV === "production" && !warnedAboutLocalhost) {
    warnedAboutLocalhost = true;
    console.error(
      "[siteUrl] No SITE_URL, VERCEL_PROJECT_PRODUCTION_URL or VERCEL_URL is set, so every " +
        "absolute link is being built against http://localhost:3000. That includes the " +
        "magic-link sign-in email and Stripe's return URLs, which means sign-in and checkout " +
        "are both broken. Set SITE_URL to the site's real origin."
    );
  }
  return "http://localhost:3000";
}
