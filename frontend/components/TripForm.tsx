"use client";

import { DateRangePicker } from "./DateRangePicker";
import { SingleDatePicker } from "./SingleDatePicker";
import { Field, inputStyle } from "./ui";
import type { Dictionary } from "@/lib/i18n";
import type { Language, TripBriefInput } from "@/lib/types";

// Form-local shape: comma-separated fields stay strings while being typed;
// they're split into arrays only at submit time (see toTripBriefInput).
export interface TripFormState {
  destinations: string;
  origin: string;
  start_date: string;
  end_date: string;
  party_size: string;
  party_composition: string;
  budget_total_eur: string;
  pace: TripBriefInput["pace"];
  interests: string;
  must_see: string;
  dietary_constraints: string;
  mobility_constraints: string;
  hard_no: string;
  language: Language;
  needs_lodging: boolean;
  accommodation_location: string;
  needs_flight: boolean;
  // "" means no preference - kept as a plain string (not the narrower
  // TripBriefInput union) so an empty <select> value works naturally.
  transport_preference: string;
  arrival_date: string;
  arrival_time: string;
  // Compare mode: same trip (dates/budget/party/pace/etc.), a second
  // destination - the toggle is separate from the text so unchecking it
  // doesn't need to also clear whatever was typed.
  compareEnabled: boolean;
  compareDestinations: string;
  // Optional per-destination date override for the comparison side - real
  // direct-flight availability often differs by route (e.g. one destination
  // only has direct flights Tue-Fri, another Wed-Sat), so forcing identical
  // dates on both sides of a comparison can silently make one side price in
  // a connecting flight or a date range that isn't actually the best option.
  // Defaults to the same dates as the primary trip when left off.
  compareUseDifferentDates: boolean;
  compareStartDate: string;
  compareEndDate: string;
}

export const DEFAULT_FORM_STATE: TripFormState = {
  destinations: "",
  origin: "",
  start_date: "",
  end_date: "",
  party_size: "",
  party_composition: "",
  budget_total_eur: "",
  pace: "moderate",
  interests: "",
  must_see: "",
  dietary_constraints: "",
  mobility_constraints: "",
  hard_no: "",
  language: "en",
  needs_lodging: true,
  accommodation_location: "",
  needs_flight: true,
  transport_preference: "",
  arrival_date: "",
  arrival_time: "",
  compareEnabled: false,
  compareDestinations: "",
  compareUseDifferentDates: false,
  compareStartDate: "",
  compareEndDate: "",
};

/** The comparison side's own dates, when the traveler opted into different
 * dates and actually filled both in - null means "use the same dates as the
 * primary trip," the existing default behavior. */
export function compareDateOverride(form: TripFormState): { start_date: string; end_date: string } | null {
  if (!form.compareUseDifferentDates) return null;
  const start_date = form.compareStartDate.trim();
  const end_date = form.compareEndDate.trim();
  if (!start_date || !end_date) return null;
  return { start_date, end_date };
}

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function toTripBriefInput(form: TripFormState): TripBriefInput {
  return {
    destinations: splitList(form.destinations),
    origin: form.origin.trim() || undefined,
    start_date: form.start_date.trim(),
    end_date: form.end_date.trim(),
    party_size: Number(form.party_size) || 1,
    party_composition: form.party_composition.trim(),
    budget_total_eur: form.budget_total_eur.trim() === "" ? null : Number(form.budget_total_eur),
    pace: form.pace,
    interests: splitList(form.interests),
    must_see: splitList(form.must_see),
    dietary_constraints: splitList(form.dietary_constraints),
    mobility_constraints: splitList(form.mobility_constraints),
    hard_no: splitList(form.hard_no),
    language: form.language,
    needs_lodging: form.needs_lodging,
    accommodation_location: form.needs_lodging ? undefined : form.accommodation_location.trim() || undefined,
    needs_flight: form.needs_flight,
    transport_preference: (form.transport_preference || undefined) as TripBriefInput["transport_preference"],
    arrival_date: form.needs_flight ? undefined : form.arrival_date.trim() || undefined,
    arrival_time: form.needs_flight ? undefined : form.arrival_time.trim() || undefined,
  };
}

interface TripFormProps {
  value: TripFormState;
  onChange: (next: TripFormState) => void;
  onSubmit: () => void;
  submitting: boolean;
  submittingLabel?: string;
  t: Dictionary;
}

export function TripForm({ value, onChange, onSubmit, submitting, submittingLabel, t }: TripFormProps) {
  function update<K extends keyof TripFormState>(key: K, val: TripFormState[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    // A real panel again, but not the old card. White against the warm
    // page ground with one hairline and generous padding - no drop shadow,
    // no coloured border. Removing it entirely was an over-correction: the
    // page stopped showing where the product starts, and the form read as
    // text that happened to be lying on the page.
    <div className="form-panel">
      {/* The panel needed a name. Without one the form opened straight onto
          a field label, which is how it ended up reading as text lying on
          the page rather than as the thing the whole page is for. */}
      <div className="form-heading font-display">{t.form.heading}</div>
      <div className="trip-form-grid">
        <div className="form-group-label">{t.form.groupWhere}</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label={t.form.destinations}>
            <input
              style={inputStyle}
              value={value.destinations}
              onChange={(e) => update("destinations", e.target.value)}
              placeholder={t.form.destinationsPlaceholder}
            />
          </Field>
        </div>
        <div style={{ gridColumn: "1 / -1", marginBottom: value.compareEnabled ? 0 : 16 }}>
          <label className="check-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={value.compareEnabled}
              onChange={(e) => update("compareEnabled", e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--grounded)", flexShrink: 0 }}
            />
            <span className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              {t.form.compareToggleLabel}
            </span>
          </label>
        </div>
        {value.compareEnabled && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label={t.form.compareDestinations}>
              <input
                style={inputStyle}
                value={value.compareDestinations}
                onChange={(e) => update("compareDestinations", e.target.value)}
                placeholder={t.form.compareDestinationsPlaceholder}
              />
            </Field>
            <label className="check-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 8 }}>
              <input
                type="checkbox"
                checked={value.compareUseDifferentDates}
                onChange={(e) => update("compareUseDifferentDates", e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--grounded)", flexShrink: 0 }}
              />
              <span className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {t.form.compareDifferentDatesLabel}
              </span>
            </label>
            {value.compareUseDifferentDates && (
              <div style={{ marginTop: 12 }}>
                <div
                  className="font-ui"
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 7 }}
                >
                  {t.form.compareDates}
                </div>
                <DateRangePicker
                  startDate={value.compareStartDate}
                  endDate={value.compareEndDate}
                  onChange={(start, end) => onChange({ ...value, compareStartDate: start, compareEndDate: end })}
                  language={value.language}
                  placeholder={t.form.compareDatesPlaceholder}
                  toLabel={t.form.datesPickEnd}
                  prevMonthLabel={t.form.calendarPrevMonth}
                  nextMonthLabel={t.form.calendarNextMonth}
                />
              </div>
            )}
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label={t.form.origin}>
            <input
              style={inputStyle}
              value={value.origin}
              onChange={(e) => update("origin", e.target.value)}
              placeholder={t.form.originPlaceholder}
            />
          </Field>
        </div>
        {value.origin.trim() && (
          <div style={{ gridColumn: "1 / -1", marginBottom: 16 }}>
            <label className="check-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!value.needs_flight}
                onChange={(e) => update("needs_flight", !e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--grounded)", flexShrink: 0 }}
              />
              <span className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {t.form.skipFlightLabel}
              </span>
            </label>
          </div>
        )}
        {value.origin.trim() && !value.needs_flight && (
          <>
            <div>
              {/* Not <Field>: same label-click-forwarding reason as the
                  DATES field below - a plain <div> replicates Field's label
                  styling without a popover-reopening side effect. */}
              <div
                className="font-ui"
                style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 7 }}
              >
                {t.form.arrivalDate}
              </div>
              <SingleDatePicker
                date={value.arrival_date}
                onChange={(date) => update("arrival_date", date)}
                language={value.language}
                placeholder={t.form.arrivalDatePlaceholder}
                prevMonthLabel={t.form.calendarPrevMonth}
                nextMonthLabel={t.form.calendarNextMonth}
              />
            </div>
            <Field label={t.form.arrivalTime}>
              <input
                style={inputStyle}
                value={value.arrival_time}
                onChange={(e) => update("arrival_time", e.target.value)}
                placeholder={t.form.arrivalTimePlaceholder}
              />
            </Field>
          </>
        )}
        <div style={{ gridColumn: "1 / -1", marginBottom: 16 }}>
          <label className="check-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!value.needs_lodging}
              onChange={(e) => update("needs_lodging", !e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--grounded)", flexShrink: 0 }}
            />
            <span className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              {t.form.skipLodgingLabel}
            </span>
          </label>
        </div>
        {!value.needs_lodging && (
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label={t.form.accommodationLocation}>
              <input
                style={inputStyle}
                value={value.accommodation_location}
                onChange={(e) => update("accommodation_location", e.target.value)}
                placeholder={t.form.accommodationLocationPlaceholder}
              />
            </Field>
          </div>
        )}
        <div style={{ gridColumn: "1 / -1", marginBottom: 16 }}>
          {/* Not <Field>: its wrapping <label> would forward a click from any
              button inside it (the calendar's day buttons) to the first
              control in the label - the trigger button - re-toggling it
              open right after a day-click closes it. Plain <div> here
              replicates Field's label styling without that label-click
              side effect. */}
          <div
            className="font-ui"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 7 }}
          >
            {t.form.dates}
          </div>
          <DateRangePicker
            startDate={value.start_date}
            endDate={value.end_date}
            onChange={(start, end) => onChange({ ...value, start_date: start, end_date: end })}
            language={value.language}
            placeholder={t.form.datesPlaceholder}
            toLabel={t.form.datesPickEnd}
            prevMonthLabel={t.form.calendarPrevMonth}
            nextMonthLabel={t.form.calendarNextMonth}
          />
        </div>
        <div className="form-group-label">{t.form.groupWho}</div>
        <Field label={t.form.partySize}>
          <input
            type="number"
            min="1"
            style={inputStyle}
            value={value.party_size}
            onChange={(e) => update("party_size", e.target.value)}
            placeholder={t.form.partySizePlaceholder}
          />
        </Field>
        <Field label={t.form.partyDescription}>
          <input
            style={inputStyle}
            value={value.party_composition}
            onChange={(e) => update("party_composition", e.target.value)}
            placeholder={t.form.partyPlaceholder}
          />
        </Field>
        <Field label={t.form.budget}>
          <input
            type="number"
            min="0"
            style={inputStyle}
            value={value.budget_total_eur}
            onChange={(e) => update("budget_total_eur", e.target.value)}
            placeholder={t.form.budgetPlaceholder}
          />
        </Field>
        <Field label={t.form.pace}>
          <select
            style={inputStyle}
            value={value.pace}
            onChange={(e) => update("pace", e.target.value as TripFormState["pace"])}
          >
            <option value="relaxed">{t.form.paceRelaxed}</option>
            <option value="moderate">{t.form.paceModerate}</option>
            <option value="packed">{t.form.pacePacked}</option>
          </select>
        </Field>
        <Field label={t.form.transportPreference}>
          <select
            style={inputStyle}
            value={value.transport_preference}
            onChange={(e) => update("transport_preference", e.target.value)}
          >
            <option value="">{t.form.transportNoPreference}</option>
            <option value="public_transit">{t.form.transportPublicTransit}</option>
            <option value="taxi_rideshare">{t.form.transportTaxiRideshare}</option>
            <option value="walking">{t.form.transportWalking}</option>
          </select>
        </Field>
        <div className="form-group-label">{t.form.groupTaste}</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label={t.form.interests}>
            <input
              style={inputStyle}
              value={value.interests}
              onChange={(e) => update("interests", e.target.value)}
              placeholder={t.form.interestsPlaceholder}
            />
          </Field>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label={t.form.mustSee}>
            <input
              style={inputStyle}
              value={value.must_see}
              onChange={(e) => update("must_see", e.target.value)}
              placeholder={t.form.mustSeePlaceholder}
            />
          </Field>
        </div>
        <Field label={t.form.dietary}>
          <input
            style={inputStyle}
            value={value.dietary_constraints}
            onChange={(e) => update("dietary_constraints", e.target.value)}
            placeholder={t.form.dietaryPlaceholder}
          />
        </Field>
        <Field label={t.form.mobility}>
          <input
            style={inputStyle}
            value={value.mobility_constraints}
            onChange={(e) => update("mobility_constraints", e.target.value)}
            placeholder={t.form.mobilityPlaceholder}
          />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label={t.form.hardNo}>
            <input
              style={inputStyle}
              value={value.hard_no}
              onChange={(e) => update("hard_no", e.target.value)}
              placeholder={t.form.hardNoPlaceholder}
            />
          </Field>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={submitting}
        className="font-ui btn-primary"
        style={{
          marginTop: 24,
          width: "100%",
          padding: "18px 18px",
          fontWeight: 700,
          fontSize: 16,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: submitting ? "default" : "pointer",
        }}
      >
        {submitting ? (submittingLabel ?? t.form.submitting) : t.form.submit}
      </button>
    </div>
  );
}
