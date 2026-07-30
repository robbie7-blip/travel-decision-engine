"use client";

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
}

export const DEFAULT_FORM_STATE: TripFormState = {
  destinations: "Brussels, Bruges",
  origin: "",
  start_date: "2026-10-10",
  end_date: "2026-10-13",
  party_size: "2",
  party_composition: "couple, late 20s",
  budget_total_eur: "900",
  pace: "moderate",
  interests: "food, architecture, beer culture",
  must_see: "",
  dietary_constraints: "",
  mobility_constraints: "",
  hard_no: "",
  language: "en",
  needs_lodging: true,
};

function splitList(value: string): string[] {
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
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 24,
      }}
    >
      <div className="trip-form-grid">
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
        <div style={{ gridColumn: "1 / -1", marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!value.needs_lodging}
              onChange={(e) => update("needs_lodging", !e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--grounded)", flexShrink: 0 }}
            />
            <span className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
              {t.form.skipLodgingLabel}
            </span>
          </label>
        </div>
        <Field label={t.form.startDate}>
          <input
            type="date"
            style={inputStyle}
            value={value.start_date}
            onChange={(e) => update("start_date", e.target.value)}
            placeholder={t.form.startDatePlaceholder}
          />
        </Field>
        <Field label={t.form.endDate}>
          <input
            type="date"
            style={inputStyle}
            value={value.end_date}
            onChange={(e) => update("end_date", e.target.value)}
            placeholder={t.form.endDatePlaceholder}
          />
        </Field>
        <Field label={t.form.partySize}>
          <input
            type="number"
            min="1"
            style={inputStyle}
            value={value.party_size}
            onChange={(e) => update("party_size", e.target.value)}
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
        className="font-mono btn-primary"
        style={{
          marginTop: 12,
          width: "100%",
          padding: "14px 18px",
          fontWeight: 700,
          fontSize: 13,
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
