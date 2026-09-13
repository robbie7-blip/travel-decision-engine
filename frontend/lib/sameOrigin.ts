// Whether a state-changing request came from this site's own pages.
//
// POST /api/auth/verify consumes a magic-link token and sets the session
// cookie, and it accepted that POST from anywhere. That is login CSRF: an
// attacker requests a magic link for THEIR OWN account, puts the token in a
// form on a page they control, and gets a victim's browser to submit it. The
// victim is now silently signed in as the attacker, and everything they do
// next - the trips they generate, the briefs they type, the quota they
// spend - lands in the attacker's account, where the attacker can read it.
//
// `sameSite: "lax"` on the cookie does not help. SameSite governs whether an
// existing cookie is SENT with a cross-site request; it says nothing about
// whether a cross-site request may SET one. This route sets one.
//
// WHY A HEADER CHECK AND NOT A CSRF TOKEN. The usual answer is a
// synchronizer token, which needs somewhere to keep the secret - and the
// only pre-session state this app has is Redis, so it would mean a write and
// a read per sign-in attempt to defend against an attack the browser will
// already tell us about. Origin and Sec-Fetch-Site are FORBIDDEN HEADER
// NAMES: page script cannot set them, cannot remove them, and cannot forge
// them. A cross-origin form POST carries `Origin` naming the attacker's
// page, and a fetch() carries `Sec-Fetch-Site: cross-site`. Reading what the
// browser already states is sufficient here and costs nothing.
//
// Run: npm run test:same-origin

export type OriginVerdict = "same-origin" | "cross-origin" | "no-signal";

/** Where this request says it came from.
 *
 * `allowed` is the set of origins that count as ours. Plural deliberately:
 * the configured SITE_URL is not always the host actually being served - a
 * Vercel preview deployment answers on its own *.vercel.app origin while
 * SITE_URL still points at production - and a check that only knew about
 * SITE_URL would refuse sign-in on every preview. The caller passes the
 * request's own origin too, which is the honest same-origin test.
 */
export function classifyRequestOrigin(
  headers: { get(name: string): string | null },
  allowed: string[]
): OriginVerdict {
  // Sec-Fetch-Site first: it is the browser's own answer to exactly this
  // question, and it needs no URL parsing to be right.
  const site = headers.get("sec-fetch-site");
  if (site) {
    // same-site, not just same-origin: a different subdomain of our own
    // registrable domain is ours.
    if (site === "same-origin" || site === "same-site") return "same-origin";
    // "none" means a request with NO initiating origin - a typed URL, a
    // bookmark, a browser-restored session. It is allowed rather than
    // refused because an attacker's page cannot produce it: the value comes
    // from the initiator, and a page that initiates a request is an
    // initiator. There is no way to make a victim's browser POST with
    // "none" from a site you control.
    if (site === "none") return "same-origin";
    return "cross-origin";
  }

  // Origin next, for the browsers that do not send Sec-Fetch-Site. It is
  // present on every non-GET request per the Fetch spec, same-origin ones
  // included, so the <noscript> fallback form is covered too.
  const origin = headers.get("origin");
  if (origin) {
    // "null" is the literal serialization of an OPAQUE origin - a sandboxed
    // iframe, a data: URL document. Cross-origin, emphatically: treating it
    // as no-signal would hand an attacker the bypass, because a sandboxed
    // iframe is something they can create on purpose.
    if (origin === "null") return "cross-origin";
    return allowed.some((candidate) => sameOrigin(origin, candidate)) ? "same-origin" : "cross-origin";
  }

  return "no-signal";
}

/** Origin equality by parsed components, never by string comparison.
 *
 * "https://x.com" and "https://x.com:443" are the same origin and different
 * strings; "https://x.com" and "https://x.com.evil.test" are different
 * origins and one is a prefix of the other, which is how a naive
 * startsWith check becomes the hole it was meant to close. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Whether to refuse this request.
 *
 * Only a positive cross-origin signal refuses. "no-signal" is allowed, and
 * that is a deliberate compatibility decision rather than an oversight: a
 * browser cannot strip either header - both are forbidden header names - so
 * a request with neither is not something an attack can manufacture, while
 * refusing it would break sign-in for any client that sends neither. The
 * attack this closes always arrives WITH a signal, naming the attacker.
 */
export function isCrossOriginRequest(
  headers: { get(name: string): string | null },
  allowed: string[]
): boolean {
  return classifyRequestOrigin(headers, allowed) === "cross-origin";
}

/** The origins that count as ours for a given request: whatever host is
 * actually being served, plus the configured site URL. */
export function allowedOriginsFor(requestUrl: string, siteUrl: string): string[] {
  const origins: string[] = [];
  for (const candidate of [requestUrl, siteUrl]) {
    try {
      origins.push(new URL(candidate).origin);
    } catch {
      // A malformed configured SITE_URL must not take the request's own
      // origin down with it - getSiteUrl already logs about that case.
    }
  }
  return origins;
}
