// What the homepage counts, and the one function that sends it.
//
// The homepage now has two ways in (the bar and the full form) and a step
// between the bar and the wait ("Want it sharper?"). Whether that step
// helps or only slows people down is a question with an answer, and this
// is the smallest thing that gets it: a handful of named totals.
//
// WHAT IS SENT: the event's name and nothing else. No id, no cookie, no
// destination, no dates, no IP stored - the server only increments a
// counter (see recordHomeEvent in lib/analytics.ts). The name has to be
// on this list or the route refuses it, so it cannot become a counter for
// arbitrary strings.
//
// No imports, so the homepage bundle does not pull in the Redis client.

export const HOME_EVENT_TYPES = [
  // A trip actually requested, by which way in.
  "submit_bar",
  "submit_form",
  // The one-time "Want it sharper?" step, and how it ended.
  "nudge_shown",
  "nudge_with_detail",
  "nudge_without_detail",
  // Someone went down to the full form from the bar or the nudge.
  "full_form_opened",
  // Someone opened the real example under the hero.
  "example_opened",
] as const;

export type HomeEventType = (typeof HOME_EVENT_TYPES)[number];

export function isHomeEventType(value: unknown): value is HomeEventType {
  return typeof value === "string" && (HOME_EVENT_TYPES as readonly string[]).includes(value);
}

/** Fire and forget. sendBeacon because two of these happen just before the
 * page navigates to the trip, where a plain fetch can be cancelled. Never
 * throws: a dropped count must not touch the thing being counted. */
export function trackHomeEvent(type: HomeEventType): void {
  try {
    const body = JSON.stringify({ type });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon("/api/analytics/home", new Blob([body], { type: "application/json" }))) return;
    }
    void fetch("/api/analytics/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing to do: see above.
  }
}
