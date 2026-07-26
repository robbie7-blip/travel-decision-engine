# Phase 0 — Decision Engine

[![License: Proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](LICENSE)

This is the smallest thing that tests the actual product hypothesis: **can an LLM,
grounded in a small curated fact base, produce travel itineraries with reasoning
good enough that a person would trust and act on them?**

No app, no database, no accounts. Just a script you run and read.

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

# Phase 1 — Next.js frontend + FastAPI backend

Same engine, same schema, same `check_feasibility` / `check_budget_integrity`
logic as Phase 0 — the backend imports `engine.py` and `trip_brief.py`
directly rather than reimplementing them. What Phase 1 adds is an HTTP
boundary: a real form instead of editing `SAMPLE_BRIEFS`, and a server-side
Anthropic call so the API key never reaches the browser (the earlier
`web-demo.jsx` browser prototype called the Anthropic API directly from
client-side JS — fine for a throwaway demo, not something to ship).

```
backend/    FastAPI app — POST /api/itinerary, GET /api/health
frontend/   Next.js (App Router, TypeScript) — form + result UI
facts/      moved here from the project root so engine.py's FACTS_DIR
            (which always pointed at facts/) actually finds them
```

## Running the backend

```bash
cd backend
python3 -m venv ../.venv && source ../.venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```

> **`.env.example` vs `.env`**: `.env.example` is a committed template — it
> should only ever contain the placeholder `your_key_here`, never a real
> key. Put your actual key in `.env` (copied from the example above), which
> is gitignored and never leaves this machine. `main.py` loads `.env`
> automatically via `python-dotenv`, so no manual `export` step is needed.

`GET /api/health` should return `{"status": "ok"}` even without a key set.
`POST /api/itinerary` needs a valid `ANTHROPIC_API_KEY` — without one it
returns a clear 500 rather than a raw traceback.

Model is `claude-opus-5` (set in `backend/main.py`, `MODEL` constant) — swap
to `claude-sonnet-5` there if you want to cut cost roughly in half at a small
quality tradeoff.

## Running the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL, defaults to :8000
npm run dev
```

> `.env.local.example` → `.env.local` follows the same copy-the-template
> pattern as the backend's `.env.example` above. `NEXT_PUBLIC_API_URL` isn't
> a secret (it's a plain URL, bundled into client-side JS by design), but
> the pattern's still copy-then-edit — don't put local overrides directly
> into the committed `.example` file.

Open `http://localhost:3000` with the backend running on `:8000`. The form
posts a `TripBrief`-shaped JSON body to `/api/itinerary` and renders the
full response — budget feasibility stamp, the independent budget-integrity
warnings (the same lodging-omission check from `engine.py`), key decisions,
day-by-day items with grounded/unverified dots, and the skip list.

Unlike `web-demo.jsx`, there's no 2-day cap or compact tuple schema — the
backend isn't fighting a browser output-token budget, so it uses the full
multi-day JSON schema from `engine.py`'s `SYSTEM_PROMPT` as-is.
