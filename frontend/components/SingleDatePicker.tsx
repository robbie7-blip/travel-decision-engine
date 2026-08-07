"use client";

// A single-date picker sharing the exact calendar look of DateRangePicker
// (see lib/dateGrid.ts for the shared grid math) — used where only one date
// is meaningful (e.g. an arrival date) rather than a start/end range.

import { useEffect, useRef, useState } from "react";
import { inputStyle } from "./ui";
import { formatIsoDate, getMonthWeeks, parseIsoDate, sameDay, startOfDay } from "@/lib/dateGrid";
import type { Language } from "@/lib/types";

interface SingleDatePickerProps {
  date: string;
  onChange: (date: string) => void;
  language: Language;
  placeholder: string;
  prevMonthLabel: string;
  nextMonthLabel: string;
}

const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: "en-GB",
  bg: "bg-BG",
};

export function SingleDatePicker({ date, onChange, language, placeholder, prevMonthLabel, nextMonthLabel }: SingleDatePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = parseIsoDate(date);
  const [viewDate, setViewDate] = useState(() => selected ?? new Date());
  const locale = LOCALE_BY_LANGUAGE[language];

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

  function handleDayClick(day: Date) {
    onChange(formatIsoDate(day));
    setOpen(false);
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(viewDate);
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    // A Monday-starting reference week (2024-01-01 was a Monday), just to
    // read locale-correct short weekday names off it.
    const ref = new Date(2024, 0, 1 + i);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(ref);
  });

  const displayFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const displayText = selected ? displayFormatter.format(selected) : placeholder;

  const today = startOfDay(new Date());
  const weeks = getMonthWeeks(viewDate.getFullYear(), viewDate.getMonth());

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="font-mono"
        style={{
          ...inputStyle,
          textAlign: "left",
          cursor: "pointer",
          color: selected ? "var(--ink)" : "var(--ink-dim)",
        }}
      >
        {displayText}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 6px)",
            left: 0,
            background: "var(--bg-panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 8px 24px -8px rgba(43, 36, 28, 0.25)",
            width: 300,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              aria-label={prevMonthLabel}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "var(--ink-soft)", padding: 4 }}
            >
              ←
            </button>
            <div className="font-display" style={{ fontSize: 15, fontWeight: 600, textTransform: "capitalize" }}>
              {monthLabel}
            </div>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              aria-label={nextMonthLabel}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "var(--ink-soft)", padding: 4 }}
            >
              →
            </button>
          </div>

          <div className="font-mono" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
            {weekdayLabels.map((label, i) => (
              <div key={i} style={{ fontSize: 10, textAlign: "center", color: "var(--ink-dim)", padding: "4px 0", textTransform: "uppercase" }}>
                {label}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
              {week.map((day, di) => {
                if (!day) return <div key={di} />;
                const isSelected = selected && sameDay(day, selected);
                const isToday = sameDay(day, today);

                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => handleDayClick(day)}
                    className="font-mono"
                    style={{
                      border: isToday && !isSelected ? "1px solid var(--line)" : "none",
                      borderRadius: 6,
                      margin: 1,
                      padding: "7px 0",
                      fontSize: 12,
                      cursor: "pointer",
                      background: isSelected ? "var(--accent-green)" : "transparent",
                      color: isSelected ? "var(--bg-panel)" : "var(--ink)",
                    }}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
