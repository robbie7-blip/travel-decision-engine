// A pushback answered as a list of edits, not a rewritten trip.
//
// WHY. A refinement used to ask the model to output the ENTIRE itinerary
// again - every day, every item, every price and source - to change one
// restaurant. On a real run that was the slow part of the whole product:
// the model writes the full trip from scratch, then every venue in it is
// verified again, because the rewritten items come back without the
// Places fields the originals had earned.
//
// Now the model answers the question and lists only what changes. The
// worker applies those edits to the itinerary it already has: unchanged
// items keep everything (their verification, links, photos, ratings), and
// only the new ones go through Places. If the reply is unusable in any
// way, the caller falls back to the old full rewrite - so this can make a
// pushback faster, never worse.
//
// Pure: parsing and applying are tested without a model.
//
// Run: npm run test:refine-patch

import type { Itinerary, ItineraryDay, ItineraryItem } from "../types";

export type RefineOp =
  | { op: "replace"; ref: string; item: ItineraryItem }
  | { op: "remove"; ref: string }
  | { op: "add"; day: number; item: ItineraryItem };

export interface RefinePatch {
  pushback_response: string;
  changes: RefineOp[];
  trip_summary?: string;
  budget_feasibility?: Itinerary["budget_feasibility"];
}

/** "d2.3": day 2, the third item. Stable for one prompt, which is all a
 * ref has to be - it is how the model points at a line it wants changed. */
export function refOf(day: number, index: number): string {
  return `d${day}.${index + 1}`;
}

/** The itinerary as the model sees it for a pushback: each item with its
 * ref, and only the fields the model wrote in the first place - not the
 * Places data, which it cannot improve and does not need to repeat. */
export function itineraryForPatch(itinerary: Itinerary): unknown {
  return {
    trip_summary: itinerary.trip_summary,
    budget_feasibility: itinerary.budget_feasibility,
    days: (itinerary.days ?? []).map((day) => ({
      day: day.day,
      date: day.date,
      items: (day.items ?? []).map((item, i) => ({
        ref: refOf(day.day, i),
        time: item.time,
        type: item.type,
        title: item.title,
        venue_name: item.venue_name ?? null,
        location: item.location,
        cost_estimate_eur: item.cost_estimate_eur,
      })),
    })),
  };
}

function isItem(value: unknown): value is ItineraryItem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === "string" && v.title.trim() !== "" && typeof v.time === "string" && typeof v.type === "string";
}

/** The model's reply as a patch, or null when it is not one we can trust.
 * Null means "fall back to the full rewrite", so this errs on refusing. */
export function parseRefinePatch(raw: unknown): RefinePatch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pushback_response !== "string" || !r.pushback_response.trim()) return null;
  if (!Array.isArray(r.changes)) return null;
  const changes: RefineOp[] = [];
  for (const c of r.changes) {
    if (!c || typeof c !== "object") return null;
    const op = c as Record<string, unknown>;
    if (op.op === "replace" && typeof op.ref === "string" && isItem(op.item)) {
      changes.push({ op: "replace", ref: op.ref, item: op.item });
    } else if (op.op === "remove" && typeof op.ref === "string") {
      changes.push({ op: "remove", ref: op.ref });
    } else if (op.op === "add" && Number.isInteger(op.day) && isItem(op.item)) {
      changes.push({ op: "add", day: op.day as number, item: op.item });
    } else {
      return null;
    }
  }
  const patch: RefinePatch = { pushback_response: r.pushback_response.trim(), changes };
  if (typeof r.trip_summary === "string" && r.trip_summary.trim()) patch.trip_summary = r.trip_summary.trim();
  if (r.budget_feasibility && typeof r.budget_feasibility === "object") {
    patch.budget_feasibility = r.budget_feasibility as Itinerary["budget_feasibility"];
  }
  return patch;
}

/** The schema allows a part of the day instead of a clock time. Placed
 * where that part of the day starts, the same as frontend/lib/tripEdits.ts
 * does for hand edits: sorted as "unknown, last", a morning museum on a
 * day the patch touched went after dinner. */
const PART_OF_DAY: Record<string, number> = { morning: 9 * 60, afternoon: 14 * 60, evening: 19 * 60 };

/** Minutes since midnight for sorting, unknown times last. */
export function sortKey(time: string | undefined): number {
  const text = (time ?? "").trim().toLowerCase();
  const m = /^(\d{1,2}):(\d{2})/.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return PART_OF_DAY[text] ?? 24 * 60 + 1;
}

/** A fresh item from the model: no verification it has not earned. Every
 * google_* field (rating, link, hours, photo, coordinates) and the derived
 * confidence tier are dropped, whatever the model echoed back, so the new
 * line goes through Places like any other new line. */
function freshItem(item: ItineraryItem): ItineraryItem {
  const clean = Object.fromEntries(
    Object.entries(item).filter(([key]) => !key.startsWith("google_") && key !== "confidence_tier" && key !== "ref")
  ) as unknown as ItineraryItem;
  return { ...clean, source_urls: Array.isArray(item.source_urls) ? item.source_urls : [] };
}

/** The base itinerary with the patch applied, and the items that are new.
 * Null when the patch points at something that does not exist - a ref the
 * model invented, a day the trip does not have - because a partly applied
 * patch is a plan nobody asked for. */
export function applyRefinePatch(
  base: Itinerary,
  patch: RefinePatch
): { itinerary: Itinerary; changed: ItineraryItem[] } | null {
  const itinerary: Itinerary = JSON.parse(JSON.stringify(base));
  const days: ItineraryDay[] = itinerary.days ?? [];
  const byRef = new Map<string, { day: ItineraryDay; item: ItineraryItem }>();
  for (const day of days) (day.items ?? []).forEach((item, i) => byRef.set(refOf(day.day, i), { day, item }));

  const changed: ItineraryItem[] = [];
  const removed = new Set<ItineraryItem>();
  const touchedDays = new Set<ItineraryDay>();

  for (const change of patch.changes) {
    if (change.op === "add") {
      const day = days.find((d) => d.day === change.day);
      if (!day) return null;
      const item = freshItem(change.item);
      day.items.push(item);
      changed.push(item);
      touchedDays.add(day);
      continue;
    }
    const hit = byRef.get(change.ref);
    if (!hit || removed.has(hit.item)) return null;
    if (change.op === "remove") {
      removed.add(hit.item);
      touchedDays.add(hit.day);
    } else {
      const item = freshItem(change.item);
      const at = hit.day.items.indexOf(hit.item);
      hit.day.items[at] = item;
      removed.add(hit.item); // the old object can no longer be targeted twice
      changed.push(item);
      touchedDays.add(hit.day);
    }
  }

  for (const day of touchedDays) {
    day.items = day.items.filter((item) => !removed.has(item) || changed.includes(item));
    day.items.sort((a, b) => sortKey(a.time) - sortKey(b.time));
  }
  if (patch.trip_summary) itinerary.trip_summary = patch.trip_summary;
  if (patch.budget_feasibility) itinerary.budget_feasibility = patch.budget_feasibility;
  itinerary.pushback_response = patch.pushback_response;
  return { itinerary, changed };
}
