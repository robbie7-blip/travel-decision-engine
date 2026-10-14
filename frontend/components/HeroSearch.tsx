"use client";

// The search bar at the top of the homepage.
//
// WHY IT EXISTS. Every travel site a visitor already knows - Booking,
// Tripadvisor, any airline - opens on the thing you came to do: a field,
// in the first screen, before any argument. This page opened on the
// argument. On a phone the first field of the trip form was 1.7 screens
// down and its button 3.4, below a photo and a three-step explainer, and
// for a product nobody has heard of yet that is the order in which people
// leave.
//
// So the bar asks only what a trip cannot be planned without - where,
// when, who - and the full form further down is the same state, offered as
// optional detail rather than a gate. Nothing typed here is lost by going
// down there, and nothing typed there is lost by coming back up.
//
// It submits through the page's own handleSubmit, so there is exactly one
// path to /api/generate and everything the full form does on submit (the
// compare mode, the error handling, the redirect) happens here too.

import { useEffect, useRef, useState } from "react";
import { CityCombobox } from "./CityCombobox";
import { DateRangePicker } from "./DateRangePicker";
import { WhoPicker } from "./WhoPicker";
import type { TripFormState } from "./TripForm";
import { splitCities } from "@/lib/cityOptions";
import type { Dictionary } from "@/lib/i18n";
import { partySizeOf } from "@/lib/partyPresets";
import { MAX_TRIP_DAYS, tripDayCount } from "@/lib/validation";

type Segment = "where" | "when" | "who";

interface HeroSearchProps {
  value: TripFormState;
  onChange: (next: TripFormState) => void;
  onSubmit: () => void;
  submitting: boolean;
  /** A failure from /api/generate, when the bar was what submitted. */
  error: string | null;
  t: Dictionary;
}

/** What is missing, first one wins - the order the bar reads in. */
function firstMissing(value: TripFormState): Segment | null {
  if (splitCities(value.destinations).length === 0) return "where";
  if (!value.start_date || !value.end_date) return "when";
  const days = tripDayCount(value.start_date, value.end_date);
  if (days !== null && days > MAX_TRIP_DAYS) return "when";
  if (partySizeOf(value) === 0 || !value.party_composition.trim()) return "who";
  return null;
}

export function HeroSearch({ value, onChange, onSubmit, submitting, error, t }: HeroSearchProps) {
  const copy = t.heroSearch;
  const [missing, setMissing] = useState<Segment | null>(null);
  const whereRef = useRef<HTMLInputElement>(null);
  const whenRef = useRef<HTMLButtonElement>(null);
  const whoRef = useRef<HTMLButtonElement>(null);

  // The prompt goes away by itself once the thing it asked for is there,
  // rather than lingering until the next press of the button.
  const stillMissing = firstMissing(value);
  useEffect(() => {
    if (missing !== null && stillMissing !== missing) setMissing(null);
  }, [missing, stillMissing]);

  const dayCount = value.start_date && value.end_date ? tripDayCount(value.start_date, value.end_date) : null;
  const tooLong = dayCount !== null && dayCount > MAX_TRIP_DAYS;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const gap = firstMissing(value);
    if (gap === null) {
      setMissing(null);
      onSubmit();
      return;
    }
    setMissing(gap);
    // Take the traveller to the thing that is missing rather than only
    // describing it: the cursor in the city field, or the calendar or the
    // party picker already open.
    if (gap === "where") whereRef.current?.focus();
    else if (gap === "when" && !tooLong) whenRef.current?.click();
    else if (gap === "who") whoRef.current?.click();
  }

  /** A click on the segment's padding or caption acts on its control, so
   * the whole cell is the target, the way it is on every travel site's bar.
   * Clicks that land on a real control, or inside an open popover, are
   * left to that control. */
  function focusSegment(e: React.MouseEvent<HTMLDivElement>, segment: Segment) {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a, [role=listbox], [role=dialog], .date-popover")) return;
    e.preventDefault();
    if (segment === "where") whereRef.current?.focus();
    else if (segment === "when") whenRef.current?.click();
    else whoRef.current?.click();
  }

  const prompt =
    missing === "where"
      ? copy.missingWhere
      : missing === "when"
        ? tooLong
          ? t.form.datesTooLong.replace("{days}", String(dayCount)).replace("{max}", String(MAX_TRIP_DAYS))
          : copy.missingWhen
        : missing === "who"
          ? copy.missingWho
          : null;
  const message = prompt ?? error;

  return (
    <div className="hero-search-wrap">
      <form className="hero-search" aria-label={copy.formLabel} onSubmit={handleSubmit} noValidate>
        <div
          className="hero-search-segment"
          data-segment="where"
          data-invalid={missing === "where" || undefined}
          onMouseDown={(e) => focusSegment(e, "where")}
        >
          <span className="hero-search-caption font-ui" aria-hidden>
            {copy.where}
          </span>
          <CityCombobox
            variant="bare"
            ariaLabel={copy.where}
            inputRef={whereRef}
            value={value.destinations}
            onChange={(next) => onChange({ ...value, destinations: next })}
            language={value.language}
            placeholder={copy.wherePlaceholder}
            addMorePlaceholder={t.form.destinationsAddMore}
            removeLabel={t.form.destinationRemove}
            freeTextHint={t.form.destinationFreeText}
          />
        </div>

        <div
          className="hero-search-segment"
          data-segment="when"
          data-invalid={missing === "when" || undefined}
          onMouseDown={(e) => focusSegment(e, "when")}
        >
          <span className="hero-search-caption font-ui" aria-hidden>
            {copy.when}
          </span>
          <DateRangePicker
            variant="bare"
            ariaLabel={copy.when}
            triggerRef={whenRef}
            startDate={value.start_date}
            endDate={value.end_date}
            onChange={(start, end) => onChange({ ...value, start_date: start, end_date: end })}
            language={value.language}
            placeholder={copy.datesPlaceholder}
            toLabel={t.form.datesPickEnd}
            prevMonthLabel={t.form.calendarPrevMonth}
            nextMonthLabel={t.form.calendarNextMonth}
          />
        </div>

        <div
          className="hero-search-segment"
          data-segment="who"
          data-invalid={missing === "who" || undefined}
          onMouseDown={(e) => focusSegment(e, "who")}
        >
          <span className="hero-search-caption font-ui" aria-hidden>
            {copy.who}
          </span>
          <WhoPicker
            value={value}
            onChange={(party) => onChange({ ...value, ...party })}
            language={value.language}
            t={t}
            triggerRef={whoRef}
          />
        </div>

        <button type="submit" className="hero-search-cta font-ui" disabled={submitting} aria-busy={submitting}>
          <span>{submitting ? t.form.submitting : copy.submit}</span>
          {!submitting && (
            <span className="hero-search-cta-arrow" aria-hidden>
              →
            </span>
          )}
        </button>
      </form>

      <div className="hero-search-message font-ui" role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
