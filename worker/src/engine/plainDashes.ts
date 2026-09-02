import type { Itinerary } from "../types";

// The em dash is the single most recognisable tell that a piece of text was
// written by a model, and travelers read this text as advice from a person.
// The prompts say not to use one (see SYSTEM_PROMPT in prompt.ts), but a
// punctuation instruction is exactly the kind that leaks: it competes with
// everything else in a long prompt and with how the model writes by default.
//
// So this is the backstop. It runs on the finished itinerary, is
// deterministic, costs nothing, and cannot be talked out of it.
//
// Only prose fields are touched. Nothing here walks the object blindly,
// because some fields are data (dates, URLs, venue names as Google returned
// them) where rewriting punctuation would be wrong.

const EM_DASH = /\s*[—–]\s*/g;

/** " x — y " -> " x - y ", and a leading/trailing dash collapses to nothing
 * rather than leaving a stranded hyphen at the edge of a sentence. */
export function plainDashes(text: string): string {
  return text
    .replace(EM_DASH, " - ")
    .replace(/^\s*-\s+/, "")
    .replace(/\s+-\s*$/, "")
    .trim();
}

function fix<T>(obj: T, keys: (keyof T)[]): void {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") obj[key] = plainDashes(value) as T[keyof T];
  }
}

/** Rewrites every model-written prose field on the itinerary in place and
 * returns it, for chaining alongside the other finishing passes. */
export function stripEmDashes(itinerary: Itinerary): Itinerary {
  fix(itinerary, ["trip_summary", "pushback_response"]);
  fix(itinerary.budget_feasibility, ["reasoning"]);

  for (const decision of itinerary.key_decisions ?? []) {
    fix(decision, ["decision", "reasoning", "alternative_considered"]);
  }
  for (const skip of itinerary.things_to_skip ?? []) {
    fix(skip, ["item", "reasoning"]);
  }
  for (const day of itinerary.days ?? []) {
    fix(day, ["feasibility_flag"]);
    for (const item of day.items ?? []) {
      // title/location/reasoning are the model's own words. venue_name is
      // deliberately excluded: it is matched against Google Places, and a
      // real venue with a dash in its name has to keep it.
      fix(item, ["title", "location", "reasoning"]);
    }
  }
  return itinerary;
}
