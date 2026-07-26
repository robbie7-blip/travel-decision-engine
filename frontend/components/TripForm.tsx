"use client";

import { Field, inputStyle } from "./ui";
import type { TripBriefInput } from "@/lib/types";

// Form-local shape: comma-separated fields stay strings while being typed;
// they're split into arrays only at submit time (see toTripBriefInput).
export interface TripFormState {
  destinations: string;
  start_date: string;
  end_date: string;
  party_size: string;
  party_composition: string;
  budget_total_eur: string;
  pace: TripBriefInput["pace"];
  interests: string;
  dietary_constraints: string;
  mobility_constraints: string;
  hard_no: string;
}

export const DEFAULT_FORM_STATE: TripFormState = {
  destinations: "Brussels, Bruges",
  start_date: "2026-10-10",
  end_date: "2026-10-13",
  party_size: "2",
  party_composition: "couple, late 20s",
  budget_total_eur: "900",
  pace: "moderate",
  interests: "food, architecture, beer culture",
  dietary_constraints: "",
  mobility_constraints: "",
  hard_no: "",
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
    start_date: form.start_date.trim(),
    end_date: form.end_date.trim(),
    party_size: Number(form.party_size) || 1,
    party_composition: form.party_composition.trim(),
    budget_total_eur: form.budget_total_eur.trim() === "" ? null : Number(form.budget_total_eur),
    pace: form.pace,
    interests: splitList(form.interests),
    dietary_constraints: splitList(form.dietary_constraints),
    mobility_constraints: splitList(form.mobility_constraints),
    hard_no: splitList(form.hard_no),
  };
}

interface TripFormProps {
  value: TripFormState;
  onChange: (next: TripFormState) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function TripForm({ value, onChange, onSubmit, submitting }: TripFormProps) {
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Destinations (comma-separated)">
            <input
              style={inputStyle}
              value={value.destinations}
              onChange={(e) => update("destinations", e.target.value)}
              placeholder="Brussels, Bruges"
            />
          </Field>
        </div>
        <Field label="Start date (YYYY-MM-DD)">
          <input
            style={inputStyle}
            value={value.start_date}
            onChange={(e) => update("start_date", e.target.value)}
            placeholder="2026-10-10"
          />
        </Field>
        <Field label="End date (YYYY-MM-DD)">
          <input
            style={inputStyle}
            value={value.end_date}
            onChange={(e) => update("end_date", e.target.value)}
            placeholder="2026-10-13"
          />
        </Field>
        <Field label="Party size">
          <input
            type="number"
            min="1"
            style={inputStyle}
            value={value.party_size}
            onChange={(e) => update("party_size", e.target.value)}
          />
        </Field>
        <Field label="Party description">
          <input
            style={inputStyle}
            value={value.party_composition}
            onChange={(e) => update("party_composition", e.target.value)}
            placeholder="couple, late 20s"
          />
        </Field>
        <Field label="Total budget (EUR, optional)">
          <input
            type="number"
            min="0"
            style={inputStyle}
            value={value.budget_total_eur}
            onChange={(e) => update("budget_total_eur", e.target.value)}
            placeholder="leave blank if flexible"
          />
        </Field>
        <Field label="Pace">
          <select
            style={inputStyle}
            value={value.pace}
            onChange={(e) => update("pace", e.target.value as TripFormState["pace"])}
          >
            <option value="relaxed">Relaxed</option>
            <option value="moderate">Moderate</option>
            <option value="packed">Packed</option>
          </select>
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Interests (comma-separated)">
            <input
              style={inputStyle}
              value={value.interests}
              onChange={(e) => update("interests", e.target.value)}
              placeholder="food, architecture, beer culture"
            />
          </Field>
        </div>
        <Field label="Dietary constraints (optional)">
          <input
            style={inputStyle}
            value={value.dietary_constraints}
            onChange={(e) => update("dietary_constraints", e.target.value)}
            placeholder="vegetarian"
          />
        </Field>
        <Field label="Mobility constraints (optional)">
          <input
            style={inputStyle}
            value={value.mobility_constraints}
            onChange={(e) => update("mobility_constraints", e.target.value)}
            placeholder="limited walking"
          />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Hard constraints (optional, comma-separated)">
            <input
              style={inputStyle}
              value={value.hard_no}
              onChange={(e) => update("hard_no", e.target.value)}
              placeholder="no overnight trains, no early mornings"
            />
          </Field>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={submitting}
        className="font-mono"
        style={{
          marginTop: 8,
          width: "100%",
          background: submitting ? "var(--bg-panel-raised)" : "var(--grounded)",
          color: submitting ? "var(--ink-dim)" : "#0e1210",
          border: "none",
          borderRadius: 4,
          padding: "13px 18px",
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          cursor: submitting ? "default" : "pointer",
        }}
      >
        {submitting ? "Deciding…" : "Generate itinerary"}
      </button>
    </div>
  );
}
