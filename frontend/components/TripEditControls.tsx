"use client";

// The controls for editing a trip by hand (lib/tripEdits.ts): per line, a
// time, a day and remove; for the whole trip, a bar with the count and
// Save. The draft is only shown, never applied to the page, until it is
// saved - so a half-made set of changes can always be thrown away.

import type { Dictionary } from "@/lib/i18n";
import type { ItineraryDay, ItineraryItem } from "@/lib/types";
import type { TripEdit } from "@/lib/tripEdits";

const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function editKey(day: number, index: number): string {
  return `${day}:${index}`;
}

/** The draft with one line's change merged in; a line whose change now
 * matches the original drops out, so the count stays honest. */
export function withEdit(
  draft: Map<string, TripEdit>,
  day: number,
  index: number,
  item: ItineraryItem,
  patch: Partial<TripEdit>
): Map<string, TripEdit> {
  const next = new Map(draft);
  const key = editKey(day, index);
  const merged: TripEdit = { ...(next.get(key) ?? { day, index }), ...patch, day, index };
  if (!merged.remove) delete merged.remove;
  if (merged.toDay === day) delete merged.toDay;
  if (merged.time !== undefined && (merged.time === item.time || !CLOCK.test(merged.time))) delete merged.time;
  if (!merged.remove && merged.toDay === undefined && merged.time === undefined) next.delete(key);
  else next.set(key, merged);
  return next;
}

export function ItemEditRow({
  day,
  index,
  item,
  days,
  edit,
  onChange,
  t,
}: {
  day: number;
  index: number;
  item: ItineraryItem;
  days: ItineraryDay[];
  edit: TripEdit | undefined;
  onChange: (patch: Partial<TripEdit>) => void;
  t: Dictionary;
}) {
  const copy = t.result.edit;
  const stored = typeof item.time === "string" ? item.time.trim() : "";
  const time = edit?.time ?? (CLOCK.test(stored) ? stored.padStart(5, "0") : "");
  const removed = edit?.remove === true;
  const id = `edit-${day}-${index}`;

  return (
    <div className="trip-edit-row font-ui no-print">
      <label className="trip-edit-field" htmlFor={`${id}-time`}>
        <span>{copy.time}</span>
        <input
          id={`${id}-time`}
          type="time"
          value={time}
          disabled={removed}
          onChange={(e) => onChange({ time: e.target.value })}
        />
      </label>
      <label className="trip-edit-field" htmlFor={`${id}-day`}>
        <span>{copy.day}</span>
        <select
          id={`${id}-day`}
          value={edit?.toDay ?? day}
          disabled={removed}
          onChange={(e) => onChange({ toDay: Number(e.target.value) })}
        >
          {days.map((d) => (
            <option key={d.day} value={d.day}>
              {t.result.day} {d.day} · {d.date}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="trip-edit-remove"
        aria-pressed={removed}
        onClick={() => onChange({ remove: !removed })}
      >
        {removed ? copy.undo : copy.remove}
      </button>
    </div>
  );
}

export function TripEditBar({
  count,
  saving,
  error,
  onSave,
  onCancel,
  t,
}: {
  count: number;
  saving: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  t: Dictionary;
}) {
  const copy = t.result.edit;
  const label = count === 0 ? copy.none : count === 1 ? copy.oneChange : copy.changes.replace("{n}", String(count));
  return (
    <div className="trip-edit-bar font-ui no-print" role="region" aria-label={copy.start}>
      <div className="trip-edit-bar-inner">
        <div className="trip-edit-bar-text">
          <strong aria-live="polite">{label}</strong>
          {error ? <span className="trip-edit-error">{error}</span> : <span>{copy.hint}</span>}
        </div>
        <div className="trip-edit-bar-actions">
          <button type="button" className="trip-edit-cancel" onClick={onCancel} disabled={saving}>
            {copy.cancel}
          </button>
          <button type="button" className="btn-primary trip-edit-save" onClick={onSave} disabled={saving || count === 0}>
            {saving ? copy.saving : copy.save}
          </button>
        </div>
      </div>
    </div>
  );
}
