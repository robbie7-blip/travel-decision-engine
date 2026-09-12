// Which bucket a request counts against - the single guard in front of
// every public endpoint that costs money or sends mail.
//
// getClientIp read `x-forwarded-for` and took the FIRST entry, which is the
// one part of that header a client fully controls. `curl -H
// "X-Forwarded-For: 1.2.3.4"` chose its own rate-limit bucket, and a
// different value per request meant a fresh allowance per request. Every
// per-IP limit in ratelimit.ts was bypassable by anyone who thought to try.
//
// Six endpoints depend on it: /api/generate and /api/refine (a paid
// generation each), /api/trip-questions and /api/flight-import (a paid model
// call each), /api/feedback (durable, no-TTL Redis writes), and
// /api/auth/request-link, which sends a magic link to any address the caller
// types. That last one is the ugliest: an unbounded stream spams a
// stranger's inbox and burns the transactional email provider's quota.
//
// ratelimit.ts's own header says "unauthenticated + unlimited would mean
// anyone who finds the URL can run up the bill indefinitely". That was the
// state it was in. The daily spend cap still bounded the total bill - the
// per-IP limits are what stop ONE actor consuming everyone's budget.
//
// No Redis and no network: getClientIp reads headers off a Request.
//
// Run: npm run test:ratelimit

import { getClientIp } from "./ratelimit";
import { check, finish, heading, section } from "./testutil";

heading("client address for rate limiting");

/** A request carrying exactly these headers. */
const req = (headers: Record<string, string>): Request =>
  new Request("https://yourdecide.com/api/generate", { method: "POST", headers });

function main() {
  section("the platform's own headers win");

  {
    check("x-vercel-forwarded-for is used first", getClientIp(req({ "x-vercel-forwarded-for": "203.0.113.7" })) === "203.0.113.7");
    check("x-real-ip is next", getClientIp(req({ "x-real-ip": "203.0.113.8" })) === "203.0.113.8");
  }

  {
    // The attack, stated as the assertion that stops it. A caller-supplied
    // x-forwarded-for must not override the address the platform wrote.
    const spoofed = req({
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "203.0.113.9",
    });
    check("a forged x-forwarded-for cannot beat x-real-ip", getClientIp(spoofed) === "203.0.113.9", getClientIp(spoofed));
  }

  {
    const spoofed = req({
      "x-forwarded-for": "1.2.3.4",
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-real-ip": "203.0.113.11",
    });
    check("nor beat the vercel header", getClientIp(spoofed) === "203.0.113.10", getClientIp(spoofed));
  }

  section("falling back to x-forwarded-for uses the LAST hop");

  {
    // A proxy APPENDS the address it received the request from, so
    // everything before the last entry may have been supplied by the
    // caller. Taking the first entry is taking the attacker's value.
    const chained = req({ "x-forwarded-for": "1.2.3.4, 198.51.100.5, 203.0.113.12" });
    check("the nearest trusted hop is used", getClientIp(chained) === "203.0.113.12", getClientIp(chained));
    check("and not the caller's invention", getClientIp(chained) !== "1.2.3.4");
  }

  {
    const single = req({ "x-forwarded-for": "203.0.113.13" });
    check("a single-hop header still works", getClientIp(single) === "203.0.113.13", getClientIp(single));
  }

  {
    // A caller appending junk to the end must not push the real hop out of
    // reach - an unusable last entry is skipped, not accepted.
    const trailing = req({ "x-forwarded-for": "203.0.113.14, not-an-ip" });
    check("an unusable last hop falls back to the one before it", getClientIp(trailing) === "203.0.113.14", getClientIp(trailing));
  }

  section("one caller must not become many buckets");

  {
    // A port on the address is the cheapest way to vary the key. These have
    // to land in the same bucket.
    const bare = getClientIp(req({ "x-real-ip": "203.0.113.15" }));
    const withPort = getClientIp(req({ "x-real-ip": "203.0.113.15:54321" }));
    check("an IPv4 address with a port is the same bucket", bare === withPort, `${bare} vs ${withPort}`);
  }

  {
    const bare = getClientIp(req({ "x-real-ip": "2001:db8::1" }));
    const bracketed = getClientIp(req({ "x-real-ip": "[2001:db8::1]" }));
    const bracketedPort = getClientIp(req({ "x-real-ip": "[2001:db8::1]:443" }));
    check("a bracketed IPv6 is the same bucket as the bare one", bare === bracketed, `${bare} vs ${bracketed}`);
    check("and so is one with a port", bare === bracketedPort, `${bare} vs ${bracketedPort}`);
    check("the IPv6 address itself survives intact", bare === "2001:db8::1", bare);
  }

  {
    // Case, since these become Redis keys.
    check("case is normalised", getClientIp(req({ "x-real-ip": "2001:DB8::1" })) === "2001:db8::1", getClientIp(req({ "x-real-ip": "2001:DB8::1" })));
    check("whitespace is trimmed", getClientIp(req({ "x-forwarded-for": "  203.0.113.16  " })) === "203.0.113.16");
  }

  section("values that must never reach a Redis key");

  {
    // Anything outside the character set an address can contain is forged
    // or mangled - and it would otherwise be concatenated into a key.
    const junk = (v: string) => getClientIp(req({ "x-real-ip": v }));
    check("a hostname is rejected", junk("evil.example.com") === "unknown", junk("evil.example.com"));
    check("a value with a slash is rejected", junk("1.2.3.4/../admin") === "unknown", junk("1.2.3.4/../admin"));
    check("a value with a brace is rejected", junk("{}") === "unknown", junk("{}"));
    check("a value with a space inside is rejected", junk("1.2.3.4 5.6.7.8") === "unknown", junk("1.2.3.4 5.6.7.8"));
  }

  {
    // A caller who can choose a long value can choose a DIFFERENT long
    // value every time - both a fresh bucket and a growing Redis key.
    const long = "1".repeat(500);
    check("an over-long value is rejected", getClientIp(req({ "x-real-ip": long })) === "unknown");
    check(
      "and cannot be smuggled through the forwarded chain either",
      getClientIp(req({ "x-forwarded-for": `${long}, ${long}` })) === "unknown"
    );
  }

  section("no usable header at all");

  {
    check("a request with no headers gets the shared bucket", getClientIp(req({})) === "unknown");
    check("an empty header is not an address", getClientIp(req({ "x-forwarded-for": "" })) === "unknown");
    check("a header of only commas is not either", getClientIp(req({ "x-forwarded-for": " , , " })) === "unknown");
  }

  {
    // The shared fallback is deliberate: it THROTTLES a caller who strips
    // every header. A per-request unique fallback would hand them an
    // unlimited allowance, which is the failure this whole file exists to
    // prevent.
    const a = getClientIp(req({}));
    const b = getClientIp(req({}));
    check("two unidentifiable requests share one bucket", a === b && a === "unknown", `${a} / ${b}`);
  }

  finish();
}

main();
