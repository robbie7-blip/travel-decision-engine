// What a model call is recorded as costing - which is what the daily spend
// cap is enforced against.
//
// estimateCostUsd priced input tokens, output tokens and cache read/write
// tokens, and stopped there. Server-side tools are not billed in tokens at
// all: every web_search request is a separate per-request charge, reported
// on `usage.server_tool_use.web_search_requests`, and nothing in the
// product read that field.
//
// Three places declare the search tool - the accommodation lookup (up to
// four calls per city once both halves and their retries are counted, two
// searches allowed each), the single-call generation path, and Ask a Local,
// which fires on every question any visitor asks. From the one generation
// with a known total: $0.3562 counted against up to eight searches at a
// cent apiece, so roughly a quarter of that run's real cost was invisible.
// The counter reaches DAILY_BUDGET_USD while real spend is nearer $32, and
// the cap whose whole job is to stop that never trips.
//
// Pure arithmetic over a usage object - no key, no network, no Redis.
//
// Run: npm run test:cost
//
// NOTE: this file tests worker/src/costBudget.ts, which is kept
// byte-identical to frontend/lib/costBudget.ts (check:mirrors enforces it),
// so one suite covers both copies.

import {
  INPUT_COST_PER_MTOK_USD,
  OUTPUT_COST_PER_MTOK_USD,
  SERVER_TOOL_COST_PER_1K_USD,
  estimateCostUsd,
  ratesFor,
  type ModelUsage,
} from "./costBudget";
import { check, finish, heading, section } from "./testutil";

heading("cost estimation");

const usage = (over: Partial<ModelUsage> = {}): ModelUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  ...over,
});

/** Equal to within a hundredth of a cent - these are floating-point sums of
 * per-million rates, so exact equality is the wrong assertion. */
const near = (a: number, b: number, tol = 0.0001): boolean => Math.abs(a - b) < tol;

function main() {
  section("the rates the tests are written against");

  {
    check("input is $2/MTok", INPUT_COST_PER_MTOK_USD === 2.0, String(INPUT_COST_PER_MTOK_USD));
    check("output is $10/MTok", OUTPUT_COST_PER_MTOK_USD === 10.0, String(OUTPUT_COST_PER_MTOK_USD));
    check("server tools are $10/1k requests", SERVER_TOOL_COST_PER_1K_USD === 10.0, String(SERVER_TOOL_COST_PER_1K_USD));
  }

  section("tokens");

  {
    const c = estimateCostUsd(usage({ input_tokens: 1_000_000 }));
    check("a million input tokens costs the input rate", near(c, 2.0), String(c));
  }

  {
    const c = estimateCostUsd(usage({ output_tokens: 1_000_000 }));
    check("a million output tokens costs the output rate", near(c, 10.0), String(c));
  }

  {
    // 1.25x the input rate for a write, 0.1x for a read.
    const write = estimateCostUsd(usage({ cache_creation_input_tokens: 1_000_000 }));
    const read = estimateCostUsd(usage({ cache_read_input_tokens: 1_000_000 }));
    check("a cache write costs 1.25x input", near(write, 2.5), String(write));
    check("a cache read costs 0.1x input", near(read, 0.2), String(read));
  }

  {
    check("nulls are treated as zero", estimateCostUsd(usage({ cache_creation_input_tokens: null, cache_read_input_tokens: null })) === 0);
    check("an empty call costs nothing", estimateCostUsd(usage()) === 0);
  }

  section("server-tool requests, which are not tokens");

  {
    // The defect, as the number it hid. A lodging lookup that made eight
    // searches was recorded as costing whatever its tokens came to, and not
    // one cent of the eight.
    const searches = estimateCostUsd(usage({ server_tool_use: { web_search_requests: 8 } }));
    check("eight searches cost eight cents", near(searches, 0.08), String(searches));
    check("and they are NOT free", searches > 0, String(searches));
  }

  {
    const one = estimateCostUsd(usage({ server_tool_use: { web_search_requests: 1 } }));
    check("one search is a cent", near(one, 0.01), String(one));
    const thousand = estimateCostUsd(usage({ server_tool_use: { web_search_requests: 1000 } }));
    check("a thousand is the published rate", near(thousand, 10.0), String(thousand));
  }

  {
    // web_fetch is not declared anywhere in this product today, so this
    // counter is always zero - it is summed so that adding the tool later
    // cannot silently reopen the same hole.
    const fetches = estimateCostUsd(usage({ server_tool_use: { web_fetch_requests: 4 } }));
    check("fetch requests are counted too", near(fetches, 0.04), String(fetches));
    const both = estimateCostUsd(usage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 } }));
    check("and both counters add", near(both, 0.05), String(both));
  }

  {
    check("a null server_tool_use is zero", estimateCostUsd(usage({ server_tool_use: null })) === 0);
    check("an empty server_tool_use is zero", estimateCostUsd(usage({ server_tool_use: {} })) === 0);
    check(
      "null counters inside it are zero",
      estimateCostUsd(usage({ server_tool_use: { web_search_requests: null, web_fetch_requests: null } })) === 0
    );
    check(
      "a call with no server_tool_use key at all is unchanged",
      near(estimateCostUsd(usage({ input_tokens: 1_000_000 })), 2.0)
    );
  }

  section("a whole realistic job");

  {
    // Sized to land on the measured Rome run's real total of $0.3562: two
    // phase-1 halves, three day calls reading a cached prefix, four lodging
    // calls (both halves plus both retries) making two searches each.
    const calls: ModelUsage[] = [
      { input_tokens: 4000, output_tokens: 4500 }, // plan
      { input_tokens: 4000, output_tokens: 3000 }, // frame
      { input_tokens: 6000, output_tokens: 3800, cache_read_input_tokens: 3000 },
      { input_tokens: 6000, output_tokens: 3800, cache_read_input_tokens: 3000 },
      { input_tokens: 6000, output_tokens: 3800, cache_read_input_tokens: 3000 },
      { input_tokens: 2000, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
      { input_tokens: 2000, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
      { input_tokens: 2000, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
      { input_tokens: 2000, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
    ];
    const real = calls.reduce((sum, u) => sum + estimateCostUsd(u), 0);
    const counted = calls.reduce((sum, u) => sum + estimateCostUsd({ ...u, server_tool_use: null }), 0);
    const hidden = real - counted;

    check("the shape lands on the measured run's total", near(real, 0.3562, 0.005), `$${real.toFixed(4)}`);
    check("the searches are eight cents of it", near(hidden, 0.08), String(hidden));
    check(
      "which is roughly a quarter of the job's REAL cost",
      hidden / real > 0.2 && hidden / real < 0.25,
      `${((hidden / real) * 100).toFixed(1)}%`
    );

    // The two denominators are different and the distinction is the whole
    // point, so both are stated. As a share of the real bill it is about
    // 22%; as a share of what the counter actually recorded - which is what
    // the cap compares against - it is about 29%, because the counter is
    // the smaller number.
    check(
      "and nearly a third of what the counter recorded",
      hidden / counted > 0.25 && hidden / counted < 0.33,
      `${((hidden / counted) * 100).toFixed(1)}%`
    );

    // What that does to the cap: the counter reaching DAILY_BUDGET_USD
    // means real spend has already gone past it by the same ratio.
    const realSpendAtCap = 25 * (real / counted);
    check(
      "so the counter hits a $25 cap when real spend is about $32",
      realSpendAtCap > 31 && realSpendAtCap < 34,
      `$${realSpendAtCap.toFixed(2)}`
    );
  }

  section("nothing returns a figure the cap cannot use");

  {
    for (const u of [
      usage({ input_tokens: -5 }),
      usage({ output_tokens: Number.NaN }),
      usage({ server_tool_use: { web_search_requests: Number.NaN } }),
    ]) {
      const c = estimateCostUsd(u);
      check(
        `${JSON.stringify(u)} does not throw`,
        typeof c === "number",
        String(c)
      );
    }
    // NaN in, NaN out - deliberately not swallowed here, because a zero
    // would be a silently WRONG cost while a NaN is a visible one. What
    // must not happen is the NaN reaching Redis: recordSpend adds this to a
    // counter that lives for three days, and checkDailyBudget then returns
    // `spentUsd < DAILY_BUDGET_USD`, where every comparison against NaN is
    // false - one poisoned write blocks every generation for everyone for
    // the rest of the day. Both copies of recordSpend now refuse a
    // non-finite value; the old guard was `costUsd <= 0`, and `NaN <= 0` is
    // false.
    check(
      "a NaN token count propagates rather than silently reading as zero",
      Number.isNaN(estimateCostUsd(usage({ output_tokens: Number.NaN }))),
      String(estimateCostUsd(usage({ output_tokens: Number.NaN })))
    );
    // The point of the next line IS that comparing with NaN silently
    // returns false, which is exactly the guard the old code used.
    // Rewriting it as Number.isNaN would delete the demonstration - so the
    // rule is suppressed, and the directive sits immediately above the
    // code because disable-next-line means the NEXT LINE, comments
    // included. (Putting the explanation first is how I learned that: the
    // directive landed on a comment and the check went unguarded.)
    // eslint-disable-next-line use-isnan
    check("and NaN would have passed the old `<= 0` guard", (Number.NaN <= 0) === false);
    check("while Number.isFinite catches it", Number.isFinite(Number.NaN) === false);
  }

  section("a stage on a different model is billed at that model's rate");

  {
    // DAY_MODEL exists as a latency lever: phase 2 is mechanical enough
    // that a faster model is a real trade. estimateCostUsd took only
    // `usage` though - one flat pair of rates for every call in the job -
    // so turning that dial would have priced every day call at MODEL's
    // rate while it ran on the faster model's.
    //
    // Rates per million tokens, from the published model comparison:
    // Sonnet 5 $2/$10, Haiku 4.5 $1/$5, Opus 5 $5/$25, Fable 5.1 $10/$50.
    check("Sonnet 5 is the default rate", ratesFor("claude-sonnet-5").output === 10);
    check("Haiku 4.5 is half of it", ratesFor("claude-haiku-4-5").output === 5);
    check("and half on input too", ratesFor("claude-haiku-4-5").input === 1);
    check("Opus 5 is dearer", ratesFor("claude-opus-5").output === 25);
    check("Fable 5.1 dearer again", ratesFor("claude-fable-5-1").output === 50);

    // Every ID is a pinned snapshot with an optional date suffix, so the
    // dated and dateless forms are the same model and the same price.
    check(
      "a dated ID prices the same as its alias",
      ratesFor("claude-haiku-4-5-20251001").output === ratesFor("claude-haiku-4-5").output
    );

    // An unknown model keeps the behaviour every call had before the table
    // existed: the env-configured default pair.
    check("an unknown model falls back to the configured default", ratesFor("something-else").output === OUTPUT_COST_PER_MTOK_USD);
    check("and so does no model at all", ratesFor(undefined).output === OUTPUT_COST_PER_MTOK_USD);
    check("or a null one", ratesFor(null).output === OUTPUT_COST_PER_MTOK_USD);
  }

  {
    // The error, in money. This is why it matters rather than merely being
    // untidy: the day calls are the bulk of a generation's output tokens,
    // checkDailyBudget blocks generation at DAILY_BUDGET_USD, and an
    // overstated counter trips that cap early and stops real travellers.
    const dayCall = usage({ input_tokens: 4_000, output_tokens: 6_000 });
    const onHaiku = estimateCostUsd(dayCall, "claude-haiku-4-5");
    const mispriced = estimateCostUsd(dayCall);
    check("a day call on Haiku costs half what the flat rate said", Math.abs(mispriced / onHaiku - 2) < 1e-9, `${mispriced} vs ${onHaiku}`);
    check(
      "and the flat rate overstates it, which is the direction that blocks travellers",
      mispriced > onHaiku,
      `${mispriced} > ${onHaiku}`
    );
  }

  {
    // Cache rates follow the model too: a read is 10% of that model's own
    // input price, not of the default's.
    const cached = usage({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 });
    check("a cache read on Haiku is 10% of Haiku's input rate", Math.abs(estimateCostUsd(cached, "claude-haiku-4-5") - 0.1) < 1e-9, String(estimateCostUsd(cached, "claude-haiku-4-5")));
    check("and on Sonnet, 10% of Sonnet's", Math.abs(estimateCostUsd(cached, "claude-sonnet-5") - 0.2) < 1e-9, String(estimateCostUsd(cached, "claude-sonnet-5")));
  }

  finish();
}

main();
