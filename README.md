# decide - Travel Decision Engine

[![License: Proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/robbie7-blip/travel-decision-engine)](https://github.com/robbie7-blip/travel-decision-engine/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/robbie7-blip/travel-decision-engine)](https://github.com/robbie7-blip/travel-decision-engine/network/members)

This is the smallest thing that tests the actual product hypothesis: **can an LLM,
grounded in a small curated fact base, produce travel itineraries with reasoning
good enough that a person would trust and act on them?**

No app, no database, no accounts. Just a script you run and read.

## Branding

The mark is three converging lines - routes, or options - meeting at a
single point, then continuing on as one stroke down to a dot: many
possibilities funneled into one decided destination, the same idea the
product name is about. It went through several rejected iterations first -
a literal suitcase, a location-pin, and a compass - all read as generic
travel clip art (or, for the pin/compass, failed to survive being shrunk
to actual favicon size); see git history on `frontend/public/logo-icon.svg`
if curious why each one was dropped.

The decided stroke is a blue gradient (`#4f9aa8` → `#1f6f8a`) - the same
color already used for "grounded/verified" confidence signals throughout
the product (`--grounded` in `globals.css`), so the brand mark and the
product's own trust language reinforce each other. The three converging
"before the decision" lines fade from warm amber (`#e8a23f`) into neutral
taupe, and the destination dot (`#d9643f`, with a soft glow) is the other
warm anchor - early feedback that an all-blue version read as too cold led
to this warm/cool balance instead of a single flat color. That balance and
the converging-paths-to-a-decision shape are the fixed identity; what
changes is only the container, per context, because each context has
different physical constraints:

| Context | Asset | Treatment |
|---|---|---|
| Website header | `frontend/public/logo-icon.svg` | Transparent background, blue gradient mark - sits directly on the page's cream background |
| Browser tab favicon | `frontend/app/icon.svg` | Same as above (Next.js App Router auto-detects `app/icon.svg`) |
| "Add to Home Screen" (iOS) | `frontend/app/apple-icon.png` (180×180) | Filled with the page's own cream background (`--bg` `#f7f1e2`), full-color mark - iOS shows a plain white/black square behind a transparent icon if you don't supply a filled one, so this context requires its own background |
| Master/future use (app store, social preview, etc.) | `frontend/public/app-icon-512.png` | Same cream-filled treatment at higher resolution |

A filled tile isn't an inconsistency with the transparent web mark - it's
the same core identity (shape + color + meaning) adapted to a context that
can't render transparency the same way. If a new context comes up, adapt
the container the same way rather than inventing a new mark.

## Setup

```bash
pip install anthropic
export ANTHROPIC_API_KEY=your_key_here
cd decision_engine
python engine.py
```

This runs the two sample trip briefs in `trip_brief.py` (Brussels/Bruges,
and Lisbon) and prints a reasoned itinerary for each, then saves the raw
JSON to `outputs/`.

## What to actually do with this

1. **Read every output like a skeptical user, not a developer.** Would you
   actually follow this? Does the reasoning sound like something a knowledgeable
   friend would say, or generic filler ("explore the charming streets")?
2. **Check the grounded claims against reality.** The facts files are
   illustrative starter data, not verified - replace them with facts you've
   actually checked before trusting any cost/time claim in the output.
3. **Try to break it.** Edit `SAMPLE_BRIEFS` in `trip_brief.py` with harder
   cases: contradictory preferences, very tight budgets, destinations with no
   facts file, unreasonable pacing requests. See what the model does when it
   doesn't have good grounding - this is where "decision engine" products
   quietly become confidently wrong.
4. **Judge against your own bar, not a demo bar.** The question isn't "does
   this look impressive" - it's "would I persuade a friend to trust this over
   just Googling it themselves."

## Files

- `trip_brief.py` - the structured input schema + sample test cases
- `engine.py` - retrieval, prompt construction, LLM call, and a basic
  rule-based feasibility check that runs on top of the model's output
- `facts/*.json` - hand-curated per-city facts used to ground the model
  (currently Brussels, Bruges, Lisbon - add more before testing other cities)
- `outputs/` - created on first run, holds the raw JSON for every itinerary
  generated, so you can build a track record instead of judging from memory

## Extending city coverage

To add a city, create `facts/<city_lowercase>.json` following the same
structure as the existing files: a `category` (transit / cost / activity /
tourist_trap_warning / dietary / practical) and a `text` fact. Aim for 5-10
facts per city to start - quality and specificity matter more than volume.
Generic facts ("has many restaurants") don't ground anything; specific ones
("restaurants directly on X are overpriced, go 2 streets over") do.

## After Phase 0

If the reasoning quality holds up across ~15-20 varied test briefs, that's
your signal to move to Phase 1 (wrap this in a real form + web page - see
the technical build plan). If it doesn't, the fix is prompt/retrieval
iteration here, not more app scaffolding - don't move to Phase 1 until this
part earns your own trust.

# Phase 1 - single Next.js app

Same engine, same schema, same `check_feasibility` / `check_budget_integrity`
logic as Phase 0 - ported to TypeScript rather than imported, since there's
no Python process in this architecture. What Phase 1 adds is a real form
instead of editing `SAMPLE_BRIEFS`, and a server-side Anthropic call so the
API key never reaches the browser (the earlier `web-demo.jsx` browser
prototype called the Anthropic API directly from client-side JS - fine for
a throwaway demo, not something to ship).

This is one Next.js app, not a frontend calling a separate backend server -
`npm run dev` is the entire setup.

```
frontend/app/api/generate/route.ts   the server-side boundary - calls Claude
                                      directly using ANTHROPIC_API_KEY from
                                      the environment (never sent to the browser)
frontend/lib/engine/prompt.ts        TypeScript port of engine.py's
                                      SYSTEM_PROMPT + facts-grounding retrieval
frontend/lib/engine/checks.ts        TypeScript port of check_feasibility /
                                      check_budget_integrity
frontend/facts/*.json                grounding data, copied in so the app is
                                      self-contained (source of truth is
                                      still the project-root facts/)
frontend/app, components, lib        form + result UI (unchanged) - confidence
                                      dots, budget stamp, day-by-day itinerary
```

An earlier iteration of Phase 1 used a separate FastAPI backend
(`backend/main.py`) with the Next.js frontend calling it over HTTP. That's
superseded by the single-app version above - `backend/` is left in the repo
for reference but nothing runs it anymore.

## Running it

```bash
cd frontend
npm install
cp .env.local.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

> **`.env.local.example` vs `.env.local`**: same pattern as Phase 0's
> `.env.example` - the committed template only ever holds the placeholder
> `your_key_here`. Your real key goes in `.env.local`, which is gitignored.
> Next.js loads it automatically for server-side code (like the API route);
> since the variable has no `NEXT_PUBLIC_` prefix, it's never bundled into
> browser JS.

Open `http://localhost:3000`. The form posts a `TripBrief`-shaped JSON body
to the same-origin `/api/generate` route and renders the full response -
budget feasibility stamp, the independent budget-integrity warnings (the
same lodging-omission check from `engine.py`), key decisions, day-by-day
items with grounded/unverified dots, and the skip list.

Two optional fields beyond the original schema: `origin` (departure city -
used to generate a real first/last-day transport item instead of excluding
that leg from the budget) and `must_see` (specific non-negotiable
inclusions, treated with the same seriousness as `hard_no` but as musts
rather than avoids). Both flow through `TripBriefInput` → `buildPrompt` →
`SYSTEM_PROMPT` the same way every other field does.

Unlike `web-demo.jsx`, there's no 2-day cap or compact tuple schema - the
server isn't fighting a browser output-token budget, so it uses the full
multi-day JSON schema from `engine.py`'s `SYSTEM_PROMPT` as-is.

Model is `claude-sonnet-5` at `output_config.effort: "low"` (set in
`frontend/app/api/generate/route.ts`, `MODEL`/`EFFORT` constants) - this
combination was chosen specifically to fit inside Vercel's free-tier 60s
function-execution cap with real margin (measured ~35s per call) rather than
for cost alone. If you're self-hosting or on a plan with a longer timeout
budget, `claude-opus-5` at `"medium"` or `"high"` effort gives noticeably
deeper reasoning at the cost of ~70-100s+ per call - raise
`export const maxDuration` in the same file to match whatever your host allows.

## Deploying (Vercel)

1. Import the repo at [vercel.com/new](https://vercel.com/new)
2. Set **Root Directory** to `frontend` (this is a monorepo - the Next.js
   app isn't at the repo root)
3. Add environment variable `ANTHROPIC_API_KEY` - as **two separate
   fields**, Key and Value; don't paste `ANTHROPIC_API_KEY=sk-ant-...` as a
   single string into the Key field, that sets a differently-named variable
   with an empty value
4. Deploy

Vercel auto-detects Next.js, so build/output settings need no changes.
Whatever branch is configured as **Production Branch** (Project Settings →
Git) is what actually gets served - pushing fixes to a different branch
than that one deploys nothing, silently.

# Phase 2 - async job architecture (live web search)

Phase 1's `/api/generate` called Claude directly and blocked until the
response came back. That's fine without web search (~35s), but Vercel's
serverless functions have a hard execution-time cap (60s on Hobby, up to
800s on Pro) - and even scoped, single-category live search (checking
current lodging prices) measured ~108s for a 2-destination trip. Rather than
pay for a bigger Vercel plan to stretch a duration limit, Phase 2 decouples
generation from the HTTP request entirely: a separate always-on worker does
the actual Claude call with no time limit at all, communicating with the
Next.js app through a job queue.

```
frontend/app/api/generate/route.ts   validates the brief, writes a job record,
                                      pushes it onto the queue, returns a job id
                                      immediately - no longer calls Anthropic
frontend/app/api/job/[id]/route.ts   polling endpoint - reads job status/result
frontend/lib/jobs.ts                 shared Job type + Redis key conventions
frontend/lib/redis.ts                Upstash REST client (serverless-friendly,
                                      used only by the Next.js side)
worker/                              separate Node project - the actual
                                      generation happens here, with live web
                                      search enabled, no duration limit
worker/src/redis.ts                  standard TCP Redis client (ioredis) - the
                                      worker is long-running so it can hold a
                                      connection open and block on it (BRPOP)
worker/src/index.ts                  main loop: BRPOP a job id, generate,
                                      write the result back
```

`worker/src/engine/{prompt,checks}.ts` and `worker/src/types.ts` are local
copies of the same files under `frontend/lib/` (kept in sync by hand), not
cross-directory imports - Railway's "Root Directory: worker" setting deploys
only that subdirectory, so an import into `frontend/` would have nothing to
resolve against in production even though it works locally. `worker/facts/`
is likewise its own copy of `facts/`, with `FACTS_DIR` set via
`worker/src/env.ts` so `loadFacts()` finds it regardless of the worker's own
working directory.

When a live search backs a lodging price, the worker asks the model to
cross-check it with two independent searches (not just one) and put both
URLs into that item's `source_urls` field (rendered as "source 1"/"source 2"
links in the UI). If the two results meaningfully disagree, the model must
say so explicitly in the reasoning and set `source_agreement: "disagree"`
(shown as a "⚠ sources disagree" flag) rather than silently picking one
number; `source_urls` has 1 entry for a single-usable-result case, or `[]`
if no search backed the item. This is deliberately not built on Anthropic's
automatic citation feature - that splits prose into multiple text blocks
around each citation, which is incompatible with this app's
forced-single-JSON-block output.

Each item also gets a `confidence_tier` - `verified` (2 sources agree),
`fact_grounded` (grounded in the curated `facts/*.json` base, no live
search), `single_source`, `conflicting` (2 sources disagree), or `inferred`
(a hedged guess with nothing backing it). This is deliberately *derived* in
`checkBudgetIntegrity`'s sibling function `deriveConfidenceTiers`
(`worker/src/engine/checks.ts`) from `source_urls`/`source_agreement` the
model already reported, not self-reported by the model directly - same
"verify structurally, don't trust the self-report" reasoning as
`checkBudgetIntegrity` itself. `verified` and `fact_grounded` render with
the same color (both are genuinely checked data, just via different
mechanisms); `single_source`, `conflicting`, and `inferred` are each
visually distinct in the UI.

### User feedback loop

Every itinerary item has a "looks right" / "flag as wrong" control (the
latter opens an optional one-line comment box). Submitting either POSTs to
`frontend/app/api/feedback/route.ts`, which persists a `FeedbackEntry`
(`frontend/lib/feedback.ts`) to a durable Redis list (`feedback:all`, no
TTL - unlike job records, which expire after `JOB_TTL_SECONDS`). The entry
snapshots the full item, not just an id, since the job it came from will
have expired long before anyone reviews the feedback. This is frontend-only
(Vercel + the same Upstash Redis instance the job queue uses, just a
different keyspace) - the worker never touches it. There's no review UI
yet; for now, inspect entries directly (`redis-cli lrange feedback:all 0
-1`) or write one when volume justifies it.

### Rate limiting

The app is public and unauthenticated, and `/api/generate` costs real
Anthropic API money per request (1-2 live web searches per destination), so
both write endpoints are rate-limited per IP via `frontend/lib/ratelimit.ts`
(`@upstash/ratelimit`, same Redis instance as everything else - no new
infra). Two sliding windows per endpoint, both checked on every request:

| Endpoint | Per hour | Per day | Env vars to override |
|---|---|---|---|
| `/api/generate` | 5 | 20 | `GENERATE_RATE_LIMIT_PER_HOUR`, `GENERATE_RATE_LIMIT_PER_DAY` |
| `/api/feedback` | 30 | 100 | `FEEDBACK_RATE_LIMIT_PER_HOUR`, `FEEDBACK_RATE_LIMIT_PER_DAY` |

A blocked request gets `429` with a `Retry-After` header and a `detail`
message stating which window was hit. This bounds worst-case cost per
client, but not aggregate spend across many rotating IPs each individually
staying under their own limit - that's what the daily spend cap below is
for. For a defense against distinct-IP abuse at a much larger scale than
that, the next layer would be auth, payments, or Cloudflare-level bot
protection.

### Daily spend cap

On top of per-IP rate limiting, a global daily USD budget guards against
many distinct clients collectively costing more than intended. The worker
computes each generation's actual cost from `response.usage` (input/output
tokens × Claude Sonnet 5 pricing, see `worker/src/costBudget.ts`) and adds
it to a running total in Redis (`spend:day:YYYY-MM-DD`, UTC, 3-day TTL).
Both `/api/generate` and `/api/refine` check that same total before
enqueueing a job (`frontend/lib/spendCheck.ts`) and reject with `503` once
it's reached, resetting at UTC midnight.

| Env var | Default | Meaning |
|---|---|---|
| `DAILY_BUDGET_USD` | `25` | Total USD/day before new generations are paused |
| `INPUT_COST_PER_MTOK_USD` | `2.00` | Override if Sonnet 5 input pricing changes |
| `OUTPUT_COST_PER_MTOK_USD` | `10.00` | Override if Sonnet 5 output pricing changes |
| `BUDGET_ALERT_WEBHOOK_URL` | unset | If set, POSTed `{text}` once/day when spend crosses 80% (worker only) |

## Flight fare context (and building a price history)

Flight items carry a real, live-checked Amadeus fare rather than a model
guess (`worker/src/engine/flightPricing.ts` - the header there records why:
a confident "EUR150, likely with one connection" guess for a route that was
really a EUR43 nonstop). On top of that number, where the provider has
history for the route, the item also shows **where that fare sits against
the route's own past prices** - "Good price for this route, usually
EUR80-150".

This is deliberately *not* a prediction. It reports where today's number
falls in a range that actually happened and says nothing about where it
goes next. Real "buy or wait" needs historical prices for the specific
route, which no model can supply - asking one produces exactly the failure
mode above, in the single place where being confidently wrong costs the
traveller money.

Two things follow from that:

- Coverage is partial. Thin regional routes frequently have no history, and
  the correct behaviour is to show nothing rather than assume "typical".
  Every failure path no-ops.
- Fares are compared **per passenger**, since the provider's quartiles are
  per traveller. Comparing a group's total against them would read as
  wildly expensive on every family trip.

Separately, every real fare the worker looks up is recorded to Redis
(`worker/src/fareHistory.ts`), keyed by route and departure date, with the
days-before-departure axis any future prediction would need. Nothing reads
it yet - that's the point. The data has to exist before a feature can stand
on it, and starting to collect late is the one mistake that can't be undone
later. It's cache-grade storage on a ~400-day TTL, not a warehouse; if it
ever becomes load-bearing it wants exporting somewhere durable first.

## Generation latency

Generation wall-time is dominated by **output tokens**, which are produced
strictly serially. A 5-day itinerary is ~30 items, and emitting all of them
plus the trip-level fields from a single model call is 3,000+ tokens in one
sequential stream - no amount of search tuning touches that, which is why
generation stayed near-constant even after live search stopped being the
bottleneck.

The worker therefore generates in **two phases** (`worker/src/engine/twoPhase.ts`):

1. **Skeleton** (one call) - every decision needing a whole-trip view:
   budget feasibility, city order, which day is where, accommodation per
   city, key decisions, things to skip, and each day's *named anchor
   venues*. Small output, because it names things without writing them up.
2. **Days** (N calls, concurrent) - each expands exactly one day's plan into
   full items, reusing `SYSTEM_PROMPT` verbatim so every venue-naming,
   hedging, tone and schema rule applies identically to item writing.

Wall time becomes `skeleton + max(day)` instead of `sum(everything)`.
Cross-day consistency is handled in the skeleton rather than left to
chance: it assigns each day its own anchors, and every day call is shown
the other days' anchors so it can't reuse one. Any failure in the fast path
falls back automatically to the original single-call generation, so a
partial itinerary can never reach a traveler.

Lodging prices are resolved *before* phase 1 by `prefetchLodging`, one
small concurrent call per uncached destination, so neither phase needs a
search round-trip mid-conversation.

Every job logs a stage breakdown (`lodgingPrefetch`, `generate`,
`venuesAndFlights`, plus skeleton-vs-days inside `generate`) - read that
first before tuning anything here.

| Env var | Default | Meaning |
|---|---|---|
| `MODEL_EFFORT` | `high` | Reasoning effort on every model call. The single largest quality knob; was pinned to `low` purely to make generation fast. `low` restores that. |
| `PLAN_MODEL_EFFORT` | `MODEL_EFFORT`, capped at `medium` | Effort for phase 1B (the day plan) only - **the critical path**: the plan was measured at 68.8s of a 102.4s generation, and every day call waits on it. What it decides is structural (which city gets which days, a theme, 2-4 anchors, which meals, whether a night is spent) and the anchors are recall rather than multi-step reasoning - each one is checked against Google Places afterwards and repaired if it doesn't exist. Set `high` to restore the old behaviour, from the dashboard, with no deploy. |
| `FRAME_MODEL_EFFORT` | same as `MODEL_EFFORT` | Effort for phase 1A (the trip frame) only. Deliberately **not** capped: it decides whether the stated budget is honest - the one judgement where being wrong misleads a traveller about money - and it costs no wall clock, because the day calls run alongside it. |
| `DAY_MODEL_EFFORT` | `MODEL_EFFORT`, capped at `medium` | Effort for the phase-2 day calls only. Measured at 29.7s for ~1700 tokens of JSON, on the critical path. Every real decision is already made by the time a day call runs - the anchors are chosen, the meals listed, the accommodation fixed, the transport committed - so this is the writing-up stage thinking less hard about prose it has been handed the shape of. Set `high` to restore the old behaviour. |

The cap is a ceiling, not a level: `MODEL_EFFORT=low` still means low
everywhere, while raising `MODEL_EFFORT` cannot quietly put the two
critical-path stages back where they were. Every finished trip records which
efforts produced it (`JobTimings.efforts`, shown on the trip page), so two
runs can be compared without guessing at the configuration behind them.
| `TWO_PHASE_GENERATION` | on | Set `0` to force the original single-call path |
| `DAY_MODEL` | same as `MODEL` | Model for phase-2 day calls only; a faster one materially shortens phase 2 at some cost to prose polish. Phase 1 (all real decisions) always stays on `MODEL` |
| `MAX_PARALLEL_DAYS` | `16` | Cap on concurrent day calls, so a long trip plus comparison mode can't trip provider rate limits |
| `WORKER_CONCURRENCY` | `4` | Jobs handled at once by one worker process |
| `STREAM_STALL_MS` | `150000` | How long a **streamed** call may run before it is aborted. Streaming removes the total-duration cap that `CALL_TIMEOUT_MS` used to impose (the SDK clears its timer once response headers arrive), so this is what stops that becoming no limit at all. Sits above the slowest measured call (the 68.8s plan) and below `STALE_RUNNING_MS` (4 min), after which the app tells the traveller the job died |
| `LODGING_GRACE_MS` | `3000` | How long phase 2 waits for the live accommodation lookup *after* the trip frame's own estimate is already in hand. Bounds the WAIT, not the lookup |
| `LODGING_ATTEMPT_MS` | `30000` | Cap on one accommodation lookup attempt. Deliberately far below the client-wide 120s: that ceiling is for calls the itinerary can't be produced without, and this isn't one - it degrades to a generic estimate. Sized well clear of the one attempt anyone has timed (16.5s), because the limit only bites in one direction: cutting a lookup short costs a real nightly price, letting it run costs nothing the traveller waits for |
| `LODGING_BUDGET_MS` | `70000` | Cap on one city's whole lookup, both halves' first attempt *and* any retry together. Before this the retry had no allowance and a slow attempt plus a slow retry simply added up |
| `LODGING_MIN_ATTEMPT_MS` | `10000` | Below this much budget left, an attempt isn't started at all. A paid web-search call with a few seconds to live bills and answers nothing |

The introductory Sonnet 5 rates ($2/$10 per MTok) above are in effect
through 2026-08-31; after that, either bump the two override env vars or
update the defaults in `costBudget.ts` (kept byte-identical between
`frontend/lib/` and `worker/src/`, same convention as `jobs.ts`/`types.ts`).
Today's spend vs. budget is visible on `/admin/stats`, which turns amber at
80% of budget and red once generations are actually paused.

Separately from the frontend's 100%-blocking check, the worker logs a loud
`BUDGET ALERT` line (and POSTs to `BUDGET_ALERT_WEBHOOK_URL` if set, a
generic `{text: string}` body compatible with Slack/Discord-style incoming
webhooks) the first time a day's spend crosses `ALERT_THRESHOLD_RATIO`
(80%, see `costBudget.ts`) - an early warning, not a stricter cap, tracked
via its own once-per-day Redis flag (`spend:alerted:YYYY-MM-DD`) so it
doesn't re-fire on every job for the rest of the day.

### Links in an Ask a Local answer

Answers render as segments (`frontend/lib/linkify.ts`), never through
`dangerouslySetInnerHTML`. The text is model output, and on the photo path
it is partly a reading of an image the traveler supplied, so React's
escaping is the point: text stays text, and the only anchors that exist
are ones built from a URL the module validated with `URL()` and confirmed
to be http(s). A `javascript:` or `data:` string in an answer renders as
the plain text it is.

Place names are **not** model-written Maps URLs. The model marks a place
as `[[Roscioli]]` and the module builds a Google Maps *search* link from
the name, with the trip's city appended when it is missing. Same reasoning
as the flight link being a deterministic Google Flights search and an
itinerary item's map link being built from a place id Places actually
returned: a Maps URL carries a place id or CID, and a hallucinated one
does not fail loudly, it resolves confidently to the wrong restaurant. A
search for a name that exists lands on it; a search for an invented name
lands on "no results", which is honest and visibly different from being
sent to the wrong door.

Residual `[[`/`]]` are stripped from the rendered text, so a malformed or
nested marker degrades to plain words rather than leaking the prompt
convention into a sentence. While an answer is still streaming, a URL or
marker that runs to the end of the text stays text until the rest lands -
a link that is wrong for one chunk is a link a traveler can tap in that
chunk.

### Health

Two endpoints, for two different readers.

`/api/health` is public and says almost nothing on purpose - it is
unauthenticated, so it must not reveal which credentials are set or what
any error said. It returns `{status, redis, worker}` and, importantly,
**503 when the product cannot actually produce a trip**: the Next.js app
stays perfectly healthy while the worker is down, and trips just queue
forever. Point an uptime monitor at this one.

`/admin/health` (same `ADMIN_PASSWORD` gate as `/admin/stats`) is the
configuration view, and it exists because the two halves of this product
cannot see each other. Vercel and Railway have separate environments, so a
key set on one and missing on the other produces no error anywhere - the
code degrades politely and nobody finds out. Both incidents this project
has actually had were that exact shape: an identity-linked API key with no
`ANTHROPIC_WORKSPACE_ID` on the worker, and `GOOGLE_PLACES_API_KEY` on the
worker but not on Vercel. The page shows both environments side by side,
plus a Redis ping and the queue depth.

The worker's half arrives via a heartbeat: `main()` writes
`worker:heartbeat` every 30s with a 90s TTL (see `WORKER_HEARTBEAT_*` in
`jobs.ts`), carrying its uptime, concurrency, day model, and **the names**
of the environment variables it can see. Presence only - never a character
of a value, since this is written to Redis and read back onto a web page.
The TTL is the whole liveness mechanism: nothing marks the worker down, the
key simply stops existing shortly after the process writing it stops.
Note that a worker running a build from before the heartbeat existed reads
as down; deploy the worker as well as the frontend.

### Generation latency

`/admin/stats` carries a latency panel next to the quality one, fed by
rolling counters the worker writes after every **successful** generation
(`worker/src/timingStats.ts`, read by `frontend/lib/timingStats.ts`). An
error's duration is not a latency and errors return fast, so counting them
would make an outage look like a speed-up.

Every generation has always measured itself in detail, but the numbers
were visible only on that one trip's page, to the owner, if they still had
the link - so "are we under 30 seconds" cost a paid generation to ask, and
mostly went unasked. Same argument as the quality counters, applied to the
one number this product treats as non-negotiable.

The panel reports **buckets, not an average**: under 20s / 20-30 / 30-45 /
45-60 / over 60. The boundary between the second and third IS
`TARGET_TOTAL_MS`, so the first two together are the share that met the
target. An average is the statistic that hides this particular problem - a
few two-minute runs among many fast ones reads as "a bit slow" when it is
really a handful of travelers having a genuinely bad time.

It also counts the three known ways a run loses a large block of time at
once, each invisible in the total and each with a different fix:
`waitedForFrame` (the lodging lookup came back without a rate, putting the
trip frame on the critical path - about twenty seconds), the single-call
fallback, and day calls needing more than one wave (`MAX_PARALLEL_DAYS`
below the trip's length).

Stage averages divide by that stage's own run count, not by every job, so
re-verify - which only runs when something was repaired - reports what it
costs when it happens rather than a figure diluted by its own absence.

Refinements are excluded as well as errors. A refinement is one model call
answering a follow-up question, with no lodging prefetch and no phase 1 or
2, so counting those fast runs would inflate the share meeting a target
they were never about.

Because the writer and reader duplicate their Redis key names across the
ioredis/Upstash boundary, `npm run check:stats-keys` (which runs in CI)
fails on drift in any of four things: the key and field names, the bucket
and stage id lists **in order** - the panel treats the first two buckets
as "met the target", so a reorder alone would report the wrong number -
constants declared on both sides such as `TARGET_TOTAL_MS`, and the
heartbeat contract in the `jobs.ts` mirrors, where a one-sided rename
would make `/api/health` return 503 forever. It also fails if the quality
gate gains a check with no label on the page. Every one of those failures
is otherwise silent: a mismatched field reads as zero, which looks exactly
like "no traffic yet".

`npm run check:ci` guards the guards - it fails if any `test:*` or
`check:*` script is missing from the workflow. Three of them had been
sitting in `package.json` running nowhere, which is worse than not having
them: a missing guard is a known gap, a dormant one is a false sense of
cover.

### Feedback admin view

`/admin/feedback` lists every `FeedbackEntry` (newest first), reading
directly from Redis in a Server Component (`frontend/app/admin/feedback/
page.tsx`) - no separate API route. Protected by `frontend/middleware.ts`
via HTTP Basic Auth against a single shared `ADMIN_PASSWORD` env var (any
username works); the page 503s if that var isn't set, rather than silently
opening unprotected. This is deliberately minimal - a single-owner internal
tool, not a multi-user auth system - proportional to a solo developer
checking on feedback occasionally, not a real admin dashboard.

## Running Phase 2 locally

Needs three things running at once: a Redis instance, the worker, and the
Next.js app.

```bash
# 1. Redis - a real Upstash database, or a local one for testing:
redis-server --port 6379

# 2. Worker
cd worker
npm install
cp .env.example .env   # ANTHROPIC_API_KEY, REDIS_URL
npm start

# 3. Next.js app (separate terminal)
cd frontend
npm install
cp .env.local.example .env.local   # then add UPSTASH_REDIS_REST_URL / _TOKEN
npm run dev
```

> **Local Redis vs. Upstash**: `@upstash/redis` (used by the Next.js app)
> speaks Upstash's REST proxy protocol, not raw Redis - a plain
> `redis-server` won't work for that half. The worker's `ioredis` client
> speaks standard Redis TCP and works with either. For a fully local dev
> loop without an Upstash account, run `serverless-redis-http` (Upstash's
> own local REST-to-Redis proxy) in front of a local `redis-server`; for
> deployed environments, Upstash provides both endpoints directly.

## Deploying Phase 2

1. **Upstash** - create a Redis database at [upstash.com](https://upstash.com).
   Grab both the REST URL/token (for Vercel) and the standard Redis
   connection string (for the worker).
2. **Vercel** (frontend) - add `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` alongside the existing env vars. `maxDuration`
   no longer matters for `/api/generate` - the route just enqueues and
   returns. `ANTHROPIC_API_KEY` is also required here again: unlike
   itinerary generation, `/api/trip-questions` (the general trip Q&A
   feature - packing, safety, that kind of question - see
   `components/TripQA.tsx`) calls Anthropic directly from this app rather
   than through the worker's job queue, since it has no web_search tool and
   no large JSON schema to fill, so it comfortably finishes within one
   request without needing the queue's no-timeout escape hatch.
3. **Railway** (or Fly.io/Render) for the worker - deploy `worker/` as its
   own service (set Root Directory to `worker`), with `ANTHROPIC_API_KEY`
   and `REDIS_URL` (the standard connection string from step 1) as env
   vars. Start command: `npm start`. This needs to run as an always-on
   process, not a serverless function. Two more env vars here are optional
   but recommended, both free self-service signups, both no-op safely if
   left unset (generation still works, just skips that check):
   - `GOOGLE_PLACES_API_KEY` - real rating/open-closed/Maps-link
     verification for named meal/activity venues (see
     `engine/venueVerification.ts`). **Set this on Vercel as well**, not
     only here: the same key is what `frontend/app/api/venue-photo/route.ts`
     uses to serve the one real photograph per day on a finished
     itinerary. Missing on the frontend, verification still works and the
     photos simply never appear.
   - `AMADEUS_API_KEY` / `AMADEUS_API_SECRET` - a real, live-checked flight
     price for the arrival flight item, replacing the model's own guessed
     fare (see `engine/flightPricing.ts`). Sign up free at
     [developers.amadeus.com](https://developers.amadeus.com), create an
     app, and use its "API Key" / "API Secret". Without these, a flight item
     just shows a "check the real price" link with no number - genuinely
     fine, just less immediately informative than a real quoted fare.

Cost note: the fixed infra (Vercel + Upstash + a small Railway instance) is
on the order of $20-30/month at low volume - the real cost driver is
Anthropic API usage, which scales per generation (~$0.07 without search,
~$0.32-0.47 with the current lodging-only search scope, measured) rather
than being a fixed monthly number.

## Accounts + subscriptions (optional)

Entirely optional, same philosophy as `GOOGLE_PLACES_API_KEY`/
`AMADEUS_API_KEY` above: unset env vars just mean the sign-in/subscribe
buttons 500 with a clear message instead of breaking anonymous generation.

**What this adds:** an email-only "account" (magic link, no password) that
swaps a visitor off the anonymous per-IP trial limit (`ratelimit.ts`) and
onto a per-email monthly generation quota (`lib/account.ts`) - free and paid
tiers get their own cap (`NEXT_PUBLIC_FREE_MONTHLY_GENERATIONS` /
`NEXT_PUBLIC_PAID_MONTHLY_GENERATIONS`, both in `.env.local.example`). Paid
status comes from a real Stripe subscription; there's no separate
signup step - the first successful magic-link click or completed checkout
creates the Redis-backed user record.

**How identity and billing connect:** the traveler types an email on
`/pricing` before checking out; that becomes the Stripe customer's email.
The `checkout.session.completed` webhook writes a `user:<email>` record in
Redis. Separately, `/account` lets anyone request a magic link to *that
same* email - clicking it issues a signed session cookie (`lib/session.ts`,
no server-side session store). Whichever the traveler does first, the two
meet at the shared email key once both have happened. Stripe is the only
source of truth for `paid` vs `free` - the webhook is the one thing allowed
to write a subscription status.

**Setup:**
1. **Stripe** - [dashboard.stripe.com](https://dashboard.stripe.com). Create
   a recurring Price under Product catalog for `STRIPE_PRICE_ID`, grab a
   secret key for `STRIPE_SECRET_KEY`, then add a webhook endpoint at
   `{your-site}/api/stripe/webhook` listening for `checkout.session.completed`,
   `customer.subscription.updated`, and `customer.subscription.deleted` -
   its signing secret is `STRIPE_WEBHOOK_SECRET`.
2. **Resend** - [resend.com](https://resend.com), free tier. Create an API
   key (`RESEND_API_KEY`) and verify a sending domain for `EMAIL_FROM`
   (their shared onboarding domain works for testing).
3. **`SESSION_SECRET`** - any long random string (`openssl rand -base64 32`).
   Signs the session cookie; rotating it just logs everyone out.
4. All four (plus the two `NEXT_PUBLIC_*` quota vars) go on the **Vercel**
   frontend project - none of this touches the worker.

**`PRO_OVERRIDE_EMAILS`** (optional) - comma-separated list of emails that
always resolve to the paid plan (see `resolvePlan` in `lib/account.ts`),
regardless of Stripe subscription status. For the site owner's own account
(or anyone else's) to get Pro's quota and Ask a Local's web_search without
an actual subscription - dogfooding shouldn't require paying yourself.
Unset means nobody, same "off by default" shape as `ADMIN_PASSWORD`. An
override account has no real `stripeCustomerId`, so the billing portal
correctly has nothing to manage for it - `/account` hides "Manage
subscription" in that case rather than showing a button that would just
404.

### Testing without burning budget/rate limits

Visit `/admin/test-mode` (same `ADMIN_PASSWORD`-gated area as `/admin/feedback`)
and paste `ADMIN_PASSWORD` in once. Every generation from that browser
afterward skips the daily spend cap, all rate limits, and the monthly quota
- the guardrails, and only those. Doesn't affect any other visitor.

The output is deliberately **identical to a real traveler's**: same
searches, same verification, same effort. It used to also force the
degraded no-search path to make owner testing cheap, which got the
important part backwards - the one person who needs to see exactly what
ships was the only one seeing something weaker, and every "is this fast
enough / good enough" question asked of it was being answered about a
different product.

It therefore costs real API money, because a real generation does. There is
no way around that: the cost is Anthropic's per-token billing, not a
guardrail this app chose to impose. What test mode removes is the limits;
what it can't remove is the bill. For verifying pipeline *structure* without
spending anything, use `npm run test:pipeline` in `worker/` instead - it
runs the real pipeline against a stubbed model and asserts what actually
overlaps.

## Troubleshooting

Real issues hit while setting this up, in the order you're likely to hit them.

**`node: command not found` / no `npm`** - this project's dev machine
didn't ship with Node.js. Install the current LTS from
[nodejs.org](https://nodejs.org) (or via `nvm`), make sure its `bin/` is on
your `PATH`, then retry `npm install` in `frontend/`.

**`Server is misconfigured (ANTHROPIC_API_KEY is not set)`** -
`frontend/.env.local` doesn't exist yet, or has no `ANTHROPIC_API_KEY` line.
Copy it from `.env.local.example` (see "Running it" above) and restart
`npm run dev` - Next.js only reads `.env.local` at server start, so editing
it while the dev server is already running doesn't take effect until you
restart.

**`Server is misconfigured (invalid API key)`** - different from the
above: a key *was* found and sent to Anthropic, but Anthropic rejected it
(HTTP 401). Usually a copy-paste artifact - a stray or missing character on
one end of the key. Real keys start `sk-ant-api03-`; check the prefix and
length without ever printing the key itself:
```bash
python3 -c "
v = open('frontend/.env.local').read().split('ANTHROPIC_API_KEY=')[1].split()[0]
print('length:', len(v), '| starts sk-ant-:', v.startswith('sk-ant-'))
"
```
If that looks right but it's still rejected, the key may be revoked or
belong to a different org than you expect - regenerate one at
[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).

**Itinerary request returns 502, "malformed twice in a row"** - the model
occasionally emits output that isn't strict JSON (a trailing comma before a
closing `}`/`]` is the one actually observed in testing).
`extractJson()` in `route.ts` strips trailing commas before parsing and the
system prompt explicitly forbids them, but if the model finds a new way to
break strict JSON, this is where to look - either loosen the parser further
or tighten the prompt's schema instructions.

**Generation reliably times out / the client shows a generic "Something
went wrong"** - check `frontend/app/api/generate/route.ts`'s `MODEL` and
`EFFORT` constants against your host's function-duration limit. On Vercel's
free tier that's a hard 60s; `claude-opus-5` needs `"medium"` effort or
lower to have any chance of fitting, and even then can run 70-100s+. If you
switch back to `claude-opus-5` or raise effort, either raise `maxDuration`
to match a paid plan's higher limit, or expect intermittent failures on
longer trips (more days → more output tokens → longer generation time).

**Every item in a result is tagged "(unverified)"** - expected, not a bug,
if the destination has no `facts/<city_lowercase>.json` file (copied into
both `frontend/facts/` and the project-root `facts/`). This is exactly the
zero-grounding-data adversarial case the engine is designed to hedge
honestly on rather than invent numbers for. Add a facts file (see
"Extending city coverage" above) to ground that destination.

**Vercel deployment succeeds but nothing you fixed seems to take effect** -
check **Project Settings → Git → Production Branch**. If it's set to a
branch you're not pushing to (e.g. it's pinned to `main` while you're
iterating on a feature branch), every push deploys nothing to the URL
you're actually testing. Either change Production Branch to match, or merge
your branch into whatever Production Branch is set to.

**`git push` fails with `could not read Username for 'https://github.com'`**
- `gh auth login` stores credentials in the system keychain but doesn't
always wire plain `git` to use them. Run `gh auth setup-git` once, then
push normally.

**A job stays "Queued…" forever** (Phase 2) - the worker isn't running, or
it's pointed at a different Redis instance than the Next.js app. Check the
worker's logs for `[worker] started, waiting for jobs on jobs:queue`; if
that never appears, `REDIS_URL` is likely wrong or unreachable. If it does
appear but the job never gets picked up, confirm both the app's
`UPSTASH_REDIS_REST_URL`/`_TOKEN` and the worker's `REDIS_URL` point at the
*same* database - easy to mix up if you have more than one Upstash
database.

**`Server is misconfigured (job queue is not set up)`** (Phase 2) - the
Next.js app is missing `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
in its environment (`.env.local` locally, or Vercel's env var settings in
production).
