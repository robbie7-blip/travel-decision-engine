// The gap between two stops, said out loud.
//
// A day used to read as a list of times: 09:00 here, 10:00 there. What it
// never said was that "there" is four kilometres away, which is the
// difference between an itinerary that reads well and one a person can
// execute - and the most common way an AI day plan fails.
//
// Rendered between the two rows it belongs to rather than inside either,
// because it belongs to neither: it is the thing that happens after one
// and before the other, and putting it in a row would make it a property
// of a place instead of a journey.
//
// An ESTIMATE, and it says so. There is no routing behind it - a straight
// line between two verified coordinates, a detour factor, a walking pace
// (see lib/engine/travel.ts for why, and why that is the right trade on a
// pipeline fighting for seconds). This product's discipline is that every
// number on the page says where it came from, so this one is dimmer and
// lighter than the facts around it and carries a "~". A tight or
// impossible leg is the exception: that gets colour, because the whole
// point of noticing is telling someone.

import type { Dictionary } from "@/lib/i18n";
import { formatLegDistance, verdictFor, type TravelLeg as Leg } from "@/lib/engine/travel";

export function TravelLegRow({ leg, t }: { leg: Leg; t: Dictionary }) {
  const verdict = verdictFor(leg);
  const colour =
    verdict === "impossible" ? "var(--infeasible)" : verdict === "tight" ? "var(--unverified)" : "var(--ink-soft)";

  const how = leg.mode === "walk" ? t.result.travelWalk : t.result.travelTransit;
  const summary = how
    .replace("{minutes}", String(leg.minutes))
    .replace("{distance}", formatLegDistance(leg.metres));

  return (
    <div
      className="font-ui"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        // Indented to the depth of the row content above, so the legs form
        // a single line down the day rather than a second column of text.
        padding: "3px 10px 3px 42px",
        fontSize: 11,
        color: colour,
      }}
    >
      {/* Decorative: the arrow is what makes this read as "between" at a
          glance, and the text beside it already says everything. */}
      <span aria-hidden>↓</span>
      <span>{summary}</span>
      {verdict !== "ok" && leg.allowedMinutes != null && (
        <span style={{ fontWeight: 600 }}>
          {(verdict === "impossible" ? t.result.travelImpossible : t.result.travelTight).replace(
            "{allowed}",
            String(leg.allowedMinutes)
          )}
        </span>
      )}
    </div>
  );
}
