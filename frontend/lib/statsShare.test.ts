// The anonymous visited-stats share link - the only write in this app where
// an UNAUTHENTICATED caller chooses its own Redis key, and the key lives for
// 400 days.
//
// Three things were wrong with it, and they compound.
//
// THE TOKEN WAS MINTED FROM A GUESSABLE SOURCE. localVisited.ts used
// `crypto.randomUUID?.() ?? \`${Date.now()}-${Math.random()}\``, and this
// token is the whole identity behind the link - "the token IS the access
// control", as app/api/stats-share/[token] puts it. Date.now() is knowable
// to the millisecond and Math.random() is not a cryptographic generator.
// The fallback was reachable too: randomUUID exists only in a SECURE
// CONTEXT, so any plain-http origin took it, as did Safari before 15.4.
// Its output even kept the "." from Math.random(), a shape no real token
// has - nobody had exercised that branch.
//
// THE ROUTE DID NOT CHECK THE TOKEN'S SHAPE, only that it was 1-128
// characters, with a comment saying a format check was unnecessary for an
// opaque id. But it becomes a Redis key suffix, so anything - colons,
// newlines - landed in the keyspace; and a one-character token was accepted,
// which matters when the token is the only access control on what sits
// behind it.
//
// AND `codes` WAS UNBOUNDED. `typeof c === "string"` was the only filter:
// no cap on how many entries, none on how long each was, straight into
// JSON.stringify on that 400-day key.
//
// Run: npm run test:stats-share

import { isValidShareToken } from "./statsShare";
import { computeVisitedStats, sanitizeVisitedCodes } from "./visited";
import { check, finish, heading, section } from "./testutil";

heading("anonymous share token and snapshot");

function main() {
  section("the tokens this product actually issues");

  {
    // Signed-in: randomBytes(12).toString("base64url") - 16 base64url
    // characters. Device: 32 hex characters from getRandomValues.
    check("a server-issued token is accepted", isValidShareToken("Zm9vYmFyYmF6cXV4") === true);
    check("a device-minted token is accepted", isValidShareToken("a".repeat(32)) === true);
    check("base64url's - and _ are accepted", isValidShareToken("abcd-efgh_ijkl1234") === true);
  }

  section("what the old 1-to-128-character check let through");

  {
    // The capability problem. A one-character token is trivially guessed,
    // and the snapshot behind it is whatever the last caller stored.
    check("a one-character token is rejected", isValidShareToken("a") === false);
    check("so is anything under 16 characters", isValidShareToken("abcdefghijklmno") === false);
    check("exactly 16 is the boundary and is allowed", isValidShareToken("abcdefghijklmnop") === true);
  }

  {
    // The key-injection problem: this string becomes the suffix of
    // `statsShareSnapshot:${token}`.
    check("a colon is rejected", isValidShareToken("statsShareEmail:victim@x.com") === false);
    check("a newline is rejected", isValidShareToken(`abcdefghijklmnop\nabcdefghijklmnop`) === false);
    check("a slash is rejected", isValidShareToken("abcdefgh/../abcdefgh") === false);
    check("a space is rejected", isValidShareToken("abcdefgh abcdefgh") === false);
    check("a brace is rejected", isValidShareToken("abcdefghijklmnop{}") === false);
  }

  {
    // The old fallback's own output, which kept the dot from Math.random().
    // Nothing legitimate looks like this, and it would have been stored.
    check("the old predictable fallback's shape is rejected", isValidShareToken("17575551234560.5772156649") === false);
  }

  {
    check("an over-long token is rejected", isValidShareToken("a".repeat(129)) === false);
    check("128 is allowed", isValidShareToken("a".repeat(128)) === true);
  }

  {
    for (const v of [undefined, null, 0, 42, {}, [], true, ""]) {
      check(`${JSON.stringify(v) ?? "undefined"} is not a token`, isValidShareToken(v) === false);
    }
  }

  section("the snapshot is bounded by the country list, not by a guess");

  {
    const clean = sanitizeVisitedCodes(["FR", "IT", "JP"]);
    check("real codes come through", JSON.stringify(clean.sort()) === '["FR","IT","JP"]', JSON.stringify(clean));
  }

  {
    check("lowercase is normalised", JSON.stringify(sanitizeVisitedCodes(["fr"])) === '["FR"]', JSON.stringify(sanitizeVisitedCodes(["fr"])));
    check("whitespace is trimmed", JSON.stringify(sanitizeVisitedCodes([" it "])) === '["IT"]', JSON.stringify(sanitizeVisitedCodes([" it "])));
  }

  {
    // The storage vector, as the number it produced. A million entries went
    // in; what comes out is bounded by how many countries exist.
    const flood = Array.from({ length: 100_000 }, (_, i) => `X${i}`);
    const out = sanitizeVisitedCodes(flood);
    check("100,000 invented codes store nothing", out.length === 0, String(out.length));
  }

  {
    const long = ["A".repeat(50_000), "FR"];
    const out = sanitizeVisitedCodes(long);
    check("a 50,000-character entry is dropped", JSON.stringify(out) === '["FR"]', JSON.stringify(out));
  }

  {
    const dupes = Array.from({ length: 5000 }, () => "FR");
    check("five thousand copies of one country store once", sanitizeVisitedCodes(dupes).length === 1, String(sanitizeVisitedCodes(dupes).length));
  }

  {
    const mixed = sanitizeVisitedCodes(["FR", 42, null, undefined, {}, [], "ZZ", "", "  ", "IT"]);
    check("only the real codes survive a mixed list", JSON.stringify(mixed.sort()) === '["FR","IT"]', JSON.stringify(mixed));
  }

  {
    for (const v of [undefined, null, 0, "FR", {}, Number.NaN]) {
      const out = sanitizeVisitedCodes(v);
      check(`${JSON.stringify(v) ?? "undefined"} yields an empty list`, Array.isArray(out) && out.length === 0, JSON.stringify(out));
    }
  }

  section("a country counted once, however many times it is sent");

  {
    // Found by this suite, not by reading the code: the first version of
    // the case below asserted that sanitizing on write "changes nothing on
    // the way out", and it went red at 3 vs 2. computeVisitedStats did
    // `codes.filter(...)` and then `validCodes.length` - counting ENTRIES,
    // not countries - so ["FR","fr"] read as two countries visited.
    check("the same country in two cases counts once", computeVisitedStats(["FR", "fr"]).countriesVisited === 1, String(computeVisitedStats(["FR", "fr"]).countriesVisited));
  }

  {
    // The number that makes it worth a commit. The anonymous snapshot is
    // whatever an unauthenticated caller POSTed, and stats-share hands it
    // to this function for anyone with the link to read as fact - so one
    // country repeated was a claim to have seen the world.
    const repeated = computeVisitedStats(Array.from({ length: 195 }, () => "FR"));
    check("195 copies of one country is one country", repeated.countriesVisited === 1, String(repeated.countriesVisited));
    check("not 99% of the world", repeated.percentOfWorld < 1, String(repeated.percentOfWorld));
    check("and earns no badge for it", repeated.earnedBadgeIds.length <= 1, JSON.stringify(repeated.earnedBadgeIds));
  }

  {
    // The continents Set was always right, which is what made the
    // inconsistency visible once the count was fixed.
    const stats = computeVisitedStats(["FR", "fr", "FR", "JP"]);
    check("two countries on two continents", stats.countriesVisited === 2, String(stats.countriesVisited));
    check("and the continent count agrees", stats.continentsVisited.length === 2, JSON.stringify(stats.continentsVisited));
  }

  {
    // Sanitizing on write and deduping on read now agree, which is the
    // property the first version of this section wrongly assumed already
    // held.
    const dirty = ["FR", "IT", "ZZ", "XX", "fr", "  it  "];
    const before = computeVisitedStats(dirty);
    const after = computeVisitedStats(sanitizeVisitedCodes(dirty));
    check(
      "the stats are identical either way",
      before.countriesVisited === after.countriesVisited,
      `${before.countriesVisited} vs ${after.countriesVisited}`
    );
    check("and count each country once", after.countriesVisited === 2, String(after.countriesVisited));
  }

  finish();
}

main();
