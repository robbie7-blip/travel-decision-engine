"""
Phase 1 backend - FastAPI wrapper around the Phase 0 decision engine.

Reuses engine.py and trip_brief.py unchanged: same system prompt, same
retrieval, same JSON schema, same check_feasibility / check_budget_integrity
logic. The only thing this file adds is an HTTP boundary - the Anthropic API
key lives here, server-side, and is never sent to the browser.
"""

import logging
import sys
from pathlib import Path
from typing import Optional

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

load_dotenv(Path(__file__).parent / ".env")

logger = logging.getLogger("uvicorn.error")

sys.path.insert(0, str(Path(__file__).parent.parent))

from engine import check_budget_integrity, check_feasibility, generate_itinerary  # noqa: E402
from trip_brief import TripBrief  # noqa: E402

MODEL = "claude-opus-5"
# claude-opus-5 has thinking on by default, and max_tokens caps thinking +
# response text combined - engine.py's original 8000 (tuned against a model
# with thinking off) risks truncating the JSON mid-response, so give it room.
MAX_TOKENS = 12000
VALID_PACES = {"relaxed", "moderate", "packed"}

app = FastAPI(title="Travel Decision Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


class TripBriefRequest(BaseModel):
    destinations: list[str] = Field(min_length=1)
    start_date: str
    end_date: str
    party_size: int = Field(ge=1)
    party_composition: str
    budget_total_eur: Optional[int] = Field(default=None, ge=0)
    pace: str
    interests: list[str] = Field(default_factory=list)
    dietary_constraints: list[str] = Field(default_factory=list)
    mobility_constraints: list[str] = Field(default_factory=list)
    hard_no: list[str] = Field(default_factory=list)

    @field_validator("pace")
    @classmethod
    def validate_pace(cls, v: str) -> str:
        if v not in VALID_PACES:
            raise ValueError(f"pace must be one of {sorted(VALID_PACES)}")
        return v

    @field_validator("destinations", "interests", "dietary_constraints", "mobility_constraints", "hard_no")
    @classmethod
    def strip_and_drop_blanks(cls, v: list[str]) -> list[str]:
        return [s.strip() for s in v if s and s.strip()]


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/itinerary")
def create_itinerary(request: TripBriefRequest) -> dict:
    brief = TripBrief(**request.model_dump())

    try:
        try:
            itinerary = generate_itinerary(brief, model=MODEL, max_tokens=MAX_TOKENS)
        except ValueError:
            # Model occasionally returns truncated/malformed JSON - it's
            # non-deterministic, so one retry usually succeeds.
            itinerary = generate_itinerary(brief, model=MODEL, max_tokens=MAX_TOKENS)
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=500, detail="Server is misconfigured (invalid API key).")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="Rate limited by the model provider. Try again shortly.")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=503, detail="Could not reach the model provider. Try again shortly.")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Model provider error: {e.message}")
    except ValueError as e:
        raise HTTPException(
            status_code=502,
            detail="The model's response was malformed twice in a row - try a shorter or simpler trip brief.",
        ) from e
    except Exception:
        logger.exception("Unexpected error generating itinerary")
        raise HTTPException(status_code=500, detail="Server is misconfigured - check ANTHROPIC_API_KEY is set.")

    itinerary = check_feasibility(itinerary)
    itinerary = check_budget_integrity(itinerary, brief)
    return itinerary
