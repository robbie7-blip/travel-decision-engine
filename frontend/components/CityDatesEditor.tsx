"use client";

// "Set the dates for each place", on a trip to more than one (see
// lib/cityDates.ts). Nights per place rather than a calendar per place: a
// traveller thinks "three nights in Rome, then Florence", and counting
// nights means the stays always add up to the trip, with no gap or
// overlap to explain. The last place takes whatever nights are left.

import { evenNights, fitNights, nightsBetween, staysFromNights } from "@/lib/cityDates";
import { splitCities } from "@/lib/cityOptions";
import type { Dictionary } from "@/lib/i18n";
import type { TripFormState } from "./TripForm";

/** The nights in each place the form holds, made to fit the current
 * places and dates; null when there is nothing to split. */
export function currentCityNights(value: TripFormState): { cities: string[]; nights: number[] } | null {
  const cities = splitCities(value.destinations);
  const total = value.start_date && value.end_date ? nightsBetween(value.start_date, value.end_date) : null;
  if (cities.length < 2 || total === null) return null;
  const nights = fitNights(value.cityNights, cities.length, total);
  return nights ? { cities, nights } : null;
}

function dayLabel(iso: string, language: TripFormState["language"]): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "bg" ? "bg-BG" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

export function CityDatesEditor({
  value,
  onChange,
  t,
}: {
  value: TripFormState;
  onChange: (next: TripFormState) => void;
  t: Dictionary;
}) {
  const split = currentCityNights(value);
  if (!split) return null;
  const { cities, nights } = split;
  const copy = t.form;
  const stays = staysFromNights(cities, value.start_date, nights);
  const total = nights.reduce((a, b) => a + b, 0);
  const nightsText = (n: number) => (n === 1 ? copy.cityNightsOne : copy.cityNightsMany.replace("{n}", String(n)));

  /** One more night in a place, taken from the latest other place that
   * can spare one (the last place first, then the one before it); one
   * fewer, given to the last place. The total never changes. */
  function step(index: number, delta: 1 | -1) {
    const next = [...nights];
    if (delta === 1) {
      const donor = lenderFor(index);
      if (donor === null) return;
      next[donor] -= 1;
      next[index] += 1;
    } else {
      if (next[index] <= 1) return;
      next[index] -= 1;
      next[next.length - 1] += 1;
    }
    onChange({ ...value, cityNights: next, cityDatesEnabled: true });
  }

  function lenderFor(index: number): number | null {
    for (let j = nights.length - 1; j >= 0; j--) if (j !== index && nights[j] > 1) return j;
    return null;
  }

  return (
    <div className="city-dates font-ui">
      <label className="check-row city-dates-toggle">
        <input
          type="checkbox"
          checked={value.cityDatesEnabled}
          onChange={(e) =>
            onChange({
              ...value,
              cityDatesEnabled: e.target.checked,
              cityNights: e.target.checked ? nights : evenNights(cities.length, total) ?? [],
            })
          }
        />
        <span>{copy.cityDatesToggle}</span>
      </label>
      {value.cityDatesEnabled && (
        <>
          <p className="city-dates-hint">{copy.cityDatesHint}</p>
          <ol className="city-dates-list">
            {stays.map((stay, i) => {
              const last = i === stays.length - 1;
              return (
                <li key={`${stay.city}-${i}`} className="city-dates-row">
                  <div className="city-dates-place">
                    <span className="city-dates-city">{stay.city}</span>
                    <span className="city-dates-when">
                      {dayLabel(stay.start_date, value.language)} - {dayLabel(stay.end_date, value.language)}
                    </span>
                  </div>
                  {last ? (
                    <span className="city-dates-rest">{nightsText(nights[i])}</span>
                  ) : (
                    <div className="city-dates-stepper">
                      <button
                        type="button"
                        aria-label={copy.cityNightsLess.replace("{city}", stay.city)}
                        disabled={nights[i] <= 1}
                        onClick={() => step(i, -1)}
                      >
                        {"−"}
                      </button>
                      <span aria-live="polite">{nightsText(nights[i])}</span>
                      <button
                        type="button"
                        aria-label={copy.cityNightsMore.replace("{city}", stay.city)}
                        // Every other place keeps at least one night.
                        disabled={lenderFor(i) === null}
                        onClick={() => step(i, 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
