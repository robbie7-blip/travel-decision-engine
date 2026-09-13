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

import { useEffect, useRef, useState } from "react";
import { inputStyle } from "./ui";
import { clockSlots, formatClockTime, formatTimeValue, TIMES_OF_DAY } from "@/lib/timeOptions";
import type { Language } from "@/lib/types";

interface TimePickerProps {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  placeholder: string;
  /** Heading over the times-of-day group, e.g. "Not sure of the time". */
  vagueLabel: string;
  clearLabel: string;
}

const SLOTS = clockSlots();

export function TimePicker({ value, onChange, language, placeholder, vagueLabel, clearLabel }: TimePickerProps) {
  const [open, setOpen] = useState(false);
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
  // instead, once, when the popover opens.
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
    setOpen(false);
  }

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

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
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
            minWidth: 200,
            background: "var(--bg-panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 8px 24px -8px rgba(43, 36, 28, 0.25)",
          }}
        >
          <div ref={listRef} className="font-ui" style={{ maxHeight: 260, overflowY: "auto" }}>
            {hasValue && (
              <button type="button" onClick={() => choose("")} className="cal-day" style={optionStyle(false)}>
                {clearLabel}
              </button>
            )}

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
            {TIMES_OF_DAY.map((option) => (
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

            <div
              style={{
                borderTop: "1px solid var(--line)",
                marginTop: 6,
                paddingTop: 6,
              }}
            />
            {SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                onClick={() => choose(slot)}
                data-selected={value === slot}
                className="cal-day"
                style={optionStyle(value === slot)}
              >
                {formatClockTime(slot, language)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
