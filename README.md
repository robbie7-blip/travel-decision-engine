# decide — Travel Decision Engine

[![License: Proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/robbie7-blip/travel-decision-engine)](https://github.com/robbie7-blip/travel-decision-engine/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/robbie7-blip/travel-decision-engine)](https://github.com/robbie7-blip/travel-decision-engine/network/members)

This is the smallest thing that tests the actual product hypothesis: **can an LLM,
grounded in a small curated fact base, produce travel itineraries with reasoning
good enough that a person would trust and act on them?**

No app, no database, no accounts. Just a script you run and read.

## Branding

The mark is a shield silhouette with a checkmark cut into the body —
"protected/backed by something solid" (the shield) fused with
"decided/confirmed" (the checkmark). It went through several rejected
iterations first — a literal suitcase, a location-pin, and a compass —
all read as generic travel clip art (or, for the pin/compass, failed to
survive being shrunk to actual favicon size); see git history on
`frontend/public/logo-icon.svg` if curious why each one was dropped.

The color is always the same blue (`#1f6f8a` → `#5fc9d9` gradient, or flat
`#1f6f8a`) — the same color already used for "grounded/verified" confidence
signals throughout the product (`--grounded` in `globals.css`), so the
brand mark and the product's own trust language reinforce each other.
That color and the shield-plus-checkmark shape are the fixed identity;
what changes is only the container, per context, because each context has
different physical constraints:

| Context | Asset | Treatment |
|---|---|---|
| Website header | `frontend/public/logo-icon.svg` | Transparent background, blue gradient mark — sits directly on the page's cream background |
| Browser tab favicon | `frontend/app/icon.svg` | Same as above (Next.js App Router auto-detects `app/icon.svg`) |
| "Add to Home Screen" (iOS) | `frontend/app/apple-icon.png` (180×180) | Solid blue tile, white glyph — iOS shows a plain white/black square behind a transparent icon if you don't supply a filled one, so this context requires its own background |
| Master/future use (app store, social preview, etc.) | `frontend/public/app-icon-512.png` | Same filled-tile treatment at higher resolution |

A filled tile isn't an inconsistency with the transparent web mark — it's
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
   illustrative starter data, not verified — replace them with facts you've
   actually checked before trusting any cost/time claim in the output.
3. **Try to break it.** Edit `SAMPLE_BRIEFS` in `trip_brief.py` with harder
   cases: contradictory preferences, very tight budgets, destinations with no
   facts file, unreasonable pacing requests. See what the model does when it
   doesn't have good grounding — this is where "decision engine" products
   quietly become confidently wrong.
4. **Judge against your own bar, not a demo bar.** The question isn't "does
   this look impressive" — it's "would I persuade a friend to trust this over
   just Googling it themselves."

## Files

- `trip_brief.py` — the structured input schema + sample test cases
- `engine.py` — retrieval, prompt construction, LLM call, and a basic
  rule-based feasibility check that runs on top of the model's output
- `facts/*.json` — hand-curated per-city facts used to ground the model
  (currently Brussels, Bruges, Lisbon — add more before testing other cities)
- `outputs/` — created on first run, holds the raw JSON for every itinerary
  generated, so you can build a track record instead of judging from memory

## Extending city coverage

To add a city, create `facts/<city_lowercase>.json` following the same
structure as the existing files: a `category` (transit / cost / activity /
tourist_trap_warning / dietary / practical) and a `text` fact. Aim for 5-10
facts per city to start — quality and specificity matter more than volume.
Generic facts ("has many restaurants") don't ground anything; specific ones
("restaurants directly on X are overpriced, go 2 streets over") do.

## After Phase 0

If the reasoning quality holds up across ~15-20 varied test briefs, that's
your signal to move to Phase 1 (wrap this in a real form + web page — see
the technical build plan). If it doesn't, the fix is prompt/retrieval
iteration here, not more app scaffolding — don't move to Phase 1 until this
part earns your own trust.

# Phase 1 — single Next.js app

Same engine, same schema, same `check_feasibility` / `check_budget_integrity`
logic as Phase 0 — ported to TypeScript rather than imported, since there's
no Python process in this architecture. What Phase 1 adds is a real form
instead of editing `SAMPLE_BRIEFS`, and a server-side Anthropic call so the
API key never reaches the browser (the earlier `web-demo.jsx` browser
prototype called the Anthropic API directly from client-side JS — fine for
a throwaway demo, not something to ship).

This is one Next.js app, not a frontend calling a separate backend server —
`npm run dev` is the entire setup.

```
frontend/app/api/generate/route.ts   the server-side boundary — calls Claude
                                      directly using ANTHROPIC_API_KEY from
                                      the environment (never sent to the browser)
frontend/lib/engine/prompt.ts        TypeScript port of engine.py's
                                      SYSTEM_PROMPT + facts-grounding retrieval
frontend/lib/engine/checks.ts        TypeScript port of check_feasibility /
                                      check_budget_integrity
frontend/facts/*.json                grounding data, copied in so the app is
                                      self-contained (source of truth is
                                      still the project-root facts/)
frontend/app, components, lib        form + result UI (unchanged) — confidence
                                      dots, budget stamp, day-by-day itinerary
```

An earlier iteration of Phase 1 used a separate FastAPI backend
(`backend/main.py`) with the Next.js frontend calling it over HTTP. That's
superseded by the single-app version above — `backend/` is left in the repo
for reference but nothing runs it anymore.

## Running it

```bash
cd frontend
npm install
cp .env.local.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

> **`.env.local.example` vs `.env.local`**: same pattern as Phase 0's
> `.env.example` — the committed template only ever holds the placeholder
> `your_key_here`. Your real key goes in `.env.local`, which is gitignored.
> Next.js loads it automatically for server-side code (like the API route);
> since the variable has no `NEXT_PUBLIC_` prefix, it's never bundled into
> browser JS.

Open `http://localhost:3000`. The form posts a `TripBrief`-shaped JSON body
to the same-origin `/api/generate` route and renders the full response —
budget feasibility stamp, the independent budget-integrity warnings (the
same lodging-omission check from `engine.py`), key decisions, day-by-day
items with grounded/unverified dots, and the skip list.

Two optional fields beyond the original schema: `origin` (departure city —
used to generate a real first/last-day transport item instead of excluding
that leg from the budget) and `must_see` (specific non-negotiable
inclusions, treated with the same seriousness as `hard_no` but as musts
rather than avoids). Both flow through `TripBriefInput` → `buildPrompt` →
`SYSTEM_PROMPT` the same way every other field does.

Unlike `web-demo.jsx`, there's no 2-day cap or compact tuple schema — the
server isn't fighting a browser output-token budget, so it uses the full
multi-day JSON schema from `engine.py`'s `SYSTEM_PROMPT` as-is.

Model is `claude-sonnet-5` at `output_config.effort: "low"` (set in
`frontend/app/api/generate/route.ts`, `MODEL`/`EFFORT` constants) — this
combination was chosen specifically to fit inside Vercel's free-tier 60s
function-execution cap with real margin (measured ~35s per call) rather than
for cost alone. If you're self-hosting or on a plan with a longer timeout
budget, `claude-opus-5` at `"medium"` or `"high"` effort gives noticeably
deeper reasoning at the cost of ~70-100s+ per call — raise
`export const maxDuration` in the same file to match whatever your host allows.

## Deploying (Vercel)

1. Import the repo at [vercel.com/new](https://vercel.com/new)
2. Set **Root Directory** to `frontend` (this is a monorepo — the Next.js
   app isn't at the repo root)
3. Add environment variable `ANTHROPIC_API_KEY` — as **two separate
   fields**, Key and Value; don't paste `ANTHROPIC_API_KEY=sk-ant-...` as a
   single string into the Key field, that sets a differently-named variable
   with an empty value
4. Deploy

Vercel auto-detects Next.js, so build/output settings need no changes.
Whatever branch is configured as **Production Branch** (Project Settings →
Git) is what actually gets served — pushing fixes to a different branch
than that one deploys nothing, silently.

# Phase 2 — async job architecture (live web search)

Phase 1's `/api/generate` called Claude directly and blocked until the
response came back. That's fine without web search (~35s), but Vercel's
serverless functions have a hard execution-time cap (60s on Hobby, up to
800s on Pro) — and even scoped, single-category live search (checking
current lodging prices) measured ~108s for a 2-destination trip. Rather than
pay for a bigger Vercel plan to stretch a duration limit, Phase 2 decouples
generation from the HTTP request entirely: a separate always-on worker does
the actual Claude call with no time limit at all, communicating with the
Next.js app through a job queue.

```
frontend/app/api/generate/route.ts   validates the brief, writes a job record,
                                      pushes it onto the queue, returns a job id
                                      immediately — no longer calls Anthropic
frontend/app/api/job/[id]/route.ts   polling endpoint — reads job status/result
frontend/lib/jobs.ts                 shared Job type + Redis key conventions
frontend/lib/redis.ts                Upstash REST client (serverless-friendly,
                                      used only by the Next.js side)
worker/                              separate Node project — the actual
                                      generation happens here, with live web
                                      search enabled, no duration limit
worker/src/redis.ts                  standard TCP Redis client (ioredis) — the
                                      worker is long-running so it can hold a
                                      connection open and block on it (BRPOP)
worker/src/index.ts                  main loop: BRPOP a job id, generate,
                                      write the result back
```

`worker/src/engine/{prompt,checks}.ts` and `worker/src/types.ts` are local
copies of the same files under `frontend/lib/` (kept in sync by hand), not
cross-directory imports — Railway's "Root Directory: worker" setting deploys
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
automatic citation feature — that splits prose into multiple text blocks
around each citation, which is incompatible with this app's
forced-single-JSON-block output.

Each item also gets a `confidence_tier` — `verified` (2 sources agree),
`fact_grounded` (grounded in the curated `facts/*.json` base, no live
search), `single_source`, `conflicting` (2 sources disagree), or `inferred`
(a hedged guess with nothing backing it). This is deliberately *derived* in
`checkBudgetIntegrity`'s sibling function `deriveConfidenceTiers`
(`worker/src/engine/checks.ts`) from `source_urls`/`source_agreement` the
model already reported, not self-reported by the model directly — same
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
TTL — unlike job records, which expire after `JOB_TTL_SECONDS`). The entry
snapshots the full item, not just an id, since the job it came from will
have expired long before anyone reviews the feedback. This is frontend-only
(Vercel + the same Upstash Redis instance the job queue uses, just a
different keyspace) — the worker never touches it. There's no review UI
yet; for now, inspect entries directly (`redis-cli lrange feedback:all 0
-1`) or write one when volume justifies it.

### Rate limiting

The app is public and unauthenticated, and `/api/generate` costs real
Anthropic API money per request (1-2 live web searches per destination), so
both write endpoints are rate-limited per IP via `frontend/lib/ratelimit.ts`
(`@upstash/ratelimit`, same Redis instance as everything else — no new
infra). Two sliding windows per endpoint, both checked on every request:

| Endpoint | Per hour | Per day | Env vars to override |
|---|---|---|---|
| `/api/generate` | 5 | 20 | `GENERATE_RATE_LIMIT_PER_HOUR`, `GENERATE_RATE_LIMIT_PER_DAY` |
| `/api/feedback` | 30 | 100 | `FEEDBACK_RATE_LIMIT_PER_HOUR`, `FEEDBACK_RATE_LIMIT_PER_DAY` |

A blocked request gets `429` with a `Retry-After` header and a `detail`
message stating which window was hit. This bounds worst-case cost per
client, but not aggregate spend across many rotating IPs each individually
staying under their own limit — that's what the daily spend cap below is
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

The introductory Sonnet 5 rates ($2/$10 per MTok) above are in effect
through 2026-08-31; after that, either bump the two override env vars or
update the defaults in `costBudget.ts` (kept byte-identical between
`frontend/lib/` and `worker/src/`, same convention as `jobs.ts`/`types.ts`).
Today's spend vs. budget is visible on `/admin/stats`.

### Feedback admin view

`/admin/feedback` lists every `FeedbackEntry` (newest first), reading
directly from Redis in a Server Component (`frontend/app/admin/feedback/
page.tsx`) — no separate API route. Protected by `frontend/middleware.ts`
via HTTP Basic Auth against a single shared `ADMIN_PASSWORD` env var (any
username works); the page 503s if that var isn't set, rather than silently
opening unprotected. This is deliberately minimal — a single-owner internal
tool, not a multi-user auth system — proportional to a solo developer
checking on feedback occasionally, not a real admin dashboard.

## Running Phase 2 locally

Needs three things running at once: a Redis instance, the worker, and the
Next.js app.

```bash
# 1. Redis — a real Upstash database, or a local one for testing:
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
> speaks Upstash's REST proxy protocol, not raw Redis — a plain
> `redis-server` won't work for that half. The worker's `ioredis` client
> speaks standard Redis TCP and works with either. For a fully local dev
> loop without an Upstash account, run `serverless-redis-http` (Upstash's
> own local REST-to-Redis proxy) in front of a local `redis-server`; for
> deployed environments, Upstash provides both endpoints directly.

## Deploying Phase 2

1. **Upstash** — create a Redis database at [upstash.com](https://upstash.com).
   Grab both the REST URL/token (for Vercel) and the standard Redis
   connection string (for the worker).
2. **Vercel** (frontend) — add `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` alongside the existing env vars. `maxDuration`
   no longer matters here — the route just enqueues and returns.
3. **Railway** (or Fly.io/Render) for the worker — deploy `worker/` as its
   own service (set Root Directory to `worker`), with `ANTHROPIC_API_KEY`
   and `REDIS_URL` (the standard connection string from step 1) as env
   vars. Start command: `npm start`. This needs to run as an always-on
   process, not a serverless function.

Cost note: the fixed infra (Vercel + Upstash + a small Railway instance) is
on the order of $20-30/month at low volume — the real cost driver is
Anthropic API usage, which scales per generation (~$0.07 without search,
~$0.32-0.47 with the current lodging-only search scope, measured) rather
than being a fixed monthly number.

## Troubleshooting

Real issues hit while setting this up, in the order you're likely to hit them.

**`node: command not found` / no `npm`** — this project's dev machine
didn't ship with Node.js. Install the current LTS from
[nodejs.org](https://nodejs.org) (or via `nvm`), make sure its `bin/` is on
your `PATH`, then retry `npm install` in `frontend/`.

**`Server is misconfigured (ANTHROPIC_API_KEY is not set)`** —
`frontend/.env.local` doesn't exist yet, or has no `ANTHROPIC_API_KEY` line.
Copy it from `.env.local.example` (see "Running it" above) and restart
`npm run dev` — Next.js only reads `.env.local` at server start, so editing
it while the dev server is already running doesn't take effect until you
restart.

**`Server is misconfigured (invalid API key)`** — different from the
above: a key *was* found and sent to Anthropic, but Anthropic rejected it
(HTTP 401). Usually a copy-paste artifact — a stray or missing character on
one end of the key. Real keys start `sk-ant-api03-`; check the prefix and
length without ever printing the key itself:
```bash
python3 -c "
v = open('frontend/.env.local').read().split('ANTHROPIC_API_KEY=')[1].split()[0]
print('length:', len(v), '| starts sk-ant-:', v.startswith('sk-ant-'))
"
```
If that looks right but it's still rejected, the key may be revoked or
belong to a different org than you expect — regenerate one at
[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).

**Itinerary request returns 502, "malformed twice in a row"** — the model
occasionally emits output that isn't strict JSON (a trailing comma before a
closing `}`/`]` is the one actually observed in testing).
`extractJson()` in `route.ts` strips trailing commas before parsing and the
system prompt explicitly forbids them, but if the model finds a new way to
break strict JSON, this is where to look — either loosen the parser further
or tighten the prompt's schema instructions.

**Generation reliably times out / the client shows a generic "Something
went wrong"** — check `frontend/app/api/generate/route.ts`'s `MODEL` and
`EFFORT` constants against your host's function-duration limit. On Vercel's
free tier that's a hard 60s; `claude-opus-5` needs `"medium"` effort or
lower to have any chance of fitting, and even then can run 70-100s+. If you
switch back to `claude-opus-5` or raise effort, either raise `maxDuration`
to match a paid plan's higher limit, or expect intermittent failures on
longer trips (more days → more output tokens → longer generation time).

**Every item in a result is tagged "(unverified)"** — expected, not a bug,
if the destination has no `facts/<city_lowercase>.json` file (copied into
both `frontend/facts/` and the project-root `facts/`). This is exactly the
zero-grounding-data adversarial case the engine is designed to hedge
honestly on rather than invent numbers for. Add a facts file (see
"Extending city coverage" above) to ground that destination.

**Vercel deployment succeeds but nothing you fixed seems to take effect** —
check **Project Settings → Git → Production Branch**. If it's set to a
branch you're not pushing to (e.g. it's pinned to `main` while you're
iterating on a feature branch), every push deploys nothing to the URL
you're actually testing. Either change Production Branch to match, or merge
your branch into whatever Production Branch is set to.

**`git push` fails with `could not read Username for 'https://github.com'`**
— `gh auth login` stores credentials in the system keychain but doesn't
always wire plain `git` to use them. Run `gh auth setup-git` once, then
push normally.

**A job stays "Queued…" forever** (Phase 2) — the worker isn't running, or
it's pointed at a different Redis instance than the Next.js app. Check the
worker's logs for `[worker] started, waiting for jobs on jobs:queue`; if
that never appears, `REDIS_URL` is likely wrong or unreachable. If it does
appear but the job never gets picked up, confirm both the app's
`UPSTASH_REDIS_REST_URL`/`_TOKEN` and the worker's `REDIS_URL` point at the
*same* database — easy to mix up if you have more than one Upstash
database.

**`Server is misconfigured (job queue is not set up)`** (Phase 2) — the
Next.js app is missing `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
in its environment (`.env.local` locally, or Vercel's env var settings in
production).
