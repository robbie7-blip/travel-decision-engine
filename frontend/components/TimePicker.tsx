"use client";

// A time picker sharing SingleDatePicker's exact look: a button styled as
// the input, a popover, click-outside to close. Deliberately not
// <input type="time">, for the same reason the calendar next to it is not
// <input type="date"> - the native control's look is the browser's, not this
// product's, and the two sitting side by side would not match.
//
// The list is 48 half-hour slots plus the times of day, because a strict
// clock would be a capability loss: "evening" is the honest answer when
// somebody has a booking they have not looked at closely, and the prompt has
// always accepted it (see lib/timeOptions.ts).
//
// THOSE 48 SLOTS WERE ONE COLUMN, and picking 09:00 meant scrolling a list
// four screens tall - "a huge dropdown to choose from which isn't really UX
// friendly". Two changes, neither of which removes an option:
//
//   - the slots are a FOUR-COLUMN GRID, so the same 48 fit in twelve rows
//     and the whole day is visible at a glance instead of scrolled past.
//     A clock reads as a grid perfectly well; it was only ever a list
//     because that is what a <select> looks like.
//   - TYPING FILTERS IT. "9" narrows to 09:00 and 09:30, "16" to 16:00 and
//     16:30, and a word narrows the times of day. Fastest for the person
//     who already knows their flight time, which is everyone who has a
//     booking in front of them.
//
// The other half of the complaint - that the list stayed open after a
// choice - was not this file. `choose` has always closed it. It was the
// <label> wrapping the whole field in ui.tsx forwarding the click straight
// back to the trigger button, which reopened it. See Field's `popover` prop
// for the fix and the full explanation; the same bug was already worked
// around by hand for the two date pickers next to these.

import { useEffect, useRef, useState } from "react";
import { inputStyle } from "./ui";
import { clockSlots, formatClockTime, formatTimeValue, matchesTimeQuery, TIMES_OF_DAY } from "@/lib/timeOptions";
import type { Language } from "@/lib/types";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  placeholder: string;
  /** Heading over the times-of-day group, e.g. "Not sure of the time". */
  vagueLabel: string;
  clearLabel: string;
  /** Placeholder for the filter box, e.g. "Type a time". */
  filterLabel?: string;
}

const SLOTS = clockSlots();

export function TimePicker({
  value,
  onChange,
  language,
  placeholder,
  vagueLabel,
  clearLabel,
  filterLabel,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Opening onto 00:00 when 19:30 is selected would mean scrolling past
  // nineteen hours to see the answer. Scrolls the selected slot into view
  // instead, once, when the popover opens. Still worth doing with the grid:
  // twelve rows is about two screens of popover.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ block: "center" });
    }
  }, [open]);

  const display = formatTimeValue(value, language);
  const hasValue = display.length > 0;

  function choose(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  const slots = SLOTS.filter((slot) => matchesTimeQuery(slot, query));
  const vagueOptions = TIMES_OF_DAY.filter((option) =>
    matchesTimeQuery(language === "bg" ? option.bg : option.value, query)
  );

  const optionStyle = (selected: boolean) => ({
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    border: "none",
    borderRadius: 6,
    padding: "7px 10px",
    fontSize: 13,
    cursor: "pointer",
    background: selected ? "var(--accent-green)" : "transparent",
    color: selected ? "var(--bg-panel)" : "var(--ink)",
  });

  // The clock, centred in its cell rather than left-aligned like a list
  // row: in a grid the numbers line up as a table of times, which is what
  // makes it scannable.
  const slotStyle = (selected: boolean) => ({
    ...optionStyle(selected),
    textAlign: "center" as const,
    padding: "7px 4px",
    fontVariantNumeric: "tabular-nums" as const,
  });

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() =>
          setOpen((prev) => {
            // The filter is per-opening: a query left over from last time
            // would show a short list with no visible reason for it.
            if (prev) setQuery("");
            return !prev;
          })
        }
        className="font-ui"
        style={{
          ...inputStyle,
          textAlign: "left",
          cursor: "pointer",
          color: hasValue ? "var(--ink)" : "var(--ink-dim)",
        }}
      >
        {hasValue ? display : placeholder}
      </button>

      {open && (
        <div
          className="date-popover"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 6px)",
            left: 0,
            // Wide enough for four columns of "09:30" without wrapping.
            minWidth: 268,
            background: "var(--bg-panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 8px 24px -8px rgba(43, 36, 28, 0.25)",
          }}
        >
          {/* Focused on open, so somebody who knows their flight time can
              type it without aiming at anything. autoFocus is right here
              and nowhere else on this form: the popover only exists because
              it was deliberately opened. */}
          <input
            autoFocus
            className="font-ui"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setOpen(false);
                return;
              }
              if (e.key === "Enter") {
                // Enter inside a form submits it, and a half-typed time is
                // not a trip request. It commits the only remaining match
                // instead, which is what typing "0930" is asking for.
                e.preventDefault();
                const only = slots.length === 1 && vagueOptions.length === 0 ? slots[0] : null;
                const onlyVague = vagueOptions.length === 1 && slots.length === 0 ? vagueOptions[0].value : null;
                if (only) choose(only);
                else if (onlyVague) choose(onlyVague);
              }
            }}
            placeholder={filterLabel ?? ""}
            aria-label={filterLabel ?? placeholder}
            style={{
              width: "100%",
              minHeight: 34,
              boxSizing: "border-box",
              background: "var(--bg-panel)",
              border: "1px solid var(--line-strong)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 13,
              color: "var(--ink)",
              marginBottom: 6,
            }}
          />

          <div ref={listRef} className="font-ui" style={{ maxHeight: 250, overflowY: "auto" }}>
            {hasValue && !query.trim() && (
              <button type="button" onClick={() => choose("")} className="cal-day" style={optionStyle(false)}>
                {clearLabel}
              </button>
            )}

            {vagueOptions.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    color: "var(--ink-dim)",
                    padding: "8px 10px 4px",
                  }}
                >
                  {vagueLabel}
                </div>
                {vagueOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => choose(option.value)}
                    data-selected={value === option.value}
                    className="cal-day"
                    style={optionStyle(value === option.value)}
                  >
                    {language === "bg" ? option.bg : option.value}
                  </button>
                ))}
              </>
            )}

            {vagueOptions.length > 0 && slots.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid var(--line)",
                  marginTop: 6,
                  paddingTop: 6,
                }}
              />
            )}

            {/* Four across: 48 half-hour slots in twelve rows instead of
                forty-eight, which is the whole day at a glance. */}
            {slots.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => choose(slot)}
                    data-selected={value === slot}
                    className="cal-day"
                    style={slotStyle(value === slot)}
                  >
                    {formatClockTime(slot, language)}
                  </button>
                ))}
              </div>
            )}

            {slots.length === 0 && vagueOptions.length === 0 && (
              <div
                className="font-ui"
                style={{ fontSize: 12, color: "var(--ink-dim)", padding: "8px 10px" }}
              >
                {placeholder}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
