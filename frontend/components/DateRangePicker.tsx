"use client";

// A single combined start/end date picker - click once to set the start,
// click again to set the end, instead of two separate native <input
// type="date"> fields that don't visually relate to each other. No date
// library: date math stays in local Date objects (safe for calendar grid
// generation) and is only ever serialized back to "YYYY-MM-DD" via manual
// zero-padded formatting, never toISOString() (which would shift the date
// across a UTC boundary).

import { useEffect, useRef, useState } from "react";
import { inputStyle } from "./ui";
import { formatIsoDate, getMonthWeeks, parseIsoDate, sameDay, startOfDay } from "@/lib/dateGrid";
import type { Language } from "@/lib/types";

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (startDate: string, endDate: string) => void;
  language: Language;
  placeholder: string;
  toLabel: string;
  prevMonthLabel: string;
  nextMonthLabel: string;
}

const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: "en-GB",
  bg: "bg-BG",
};

export function DateRangePicker({ startDate, endDate, onChange, language, placeholder, toLabel, prevMonthLabel, nextMonthLabel }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);

  const [viewDate, setViewDate] = useState(() => start ?? new Date());
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
    const iso = formatIsoDate(day);
    if (!start || (start && end)) {
      // Nothing selected yet, or a full range already picked - this click
      // starts a fresh selection.
      onChange(iso, "");
      return;
    }
    // A start is set but no end yet - this click completes the range,
    // swapping the order if the traveler clicked an earlier date second.
    if (day < start) {
      onChange(iso, formatIsoDate(start));
    } else {
      onChange(formatIsoDate(start), iso);
    }
    setOpen(false);
  }

  function isInPreviewRange(day: Date): boolean {
    if (!start || end || !hoverDate) return false;
    const lo = start < hoverDate ? start : hoverDate;
    const hi = start < hoverDate ? hoverDate : start;
    return day >= lo && day <= hi;
  }

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(viewDate);
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    // A Monday-starting reference week (2024-01-01 was a Monday), just to
    // read locale-correct short weekday names off it.
    const ref = new Date(2024, 0, 1 + i);
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(ref);
  });

  const displayFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const displayText =
    start && end
      ? `${displayFormatter.format(start)} → ${displayFormatter.format(end)}`
      : start
        ? `${displayFormatter.format(start)} → ?`
        : placeholder;

  const today = startOfDay(new Date());
  const weeks = getMonthWeeks(viewDate.getFullYear(), viewDate.getMonth());

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
          color: start ? "var(--ink)" : "var(--ink-dim)",
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
          }}
          className="date-popover"
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              aria-label={prevMonthLabel}
              className="cal-nav"
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
              className="cal-nav"
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "var(--ink-soft)", padding: 4 }}
            >
              →
            </button>
          </div>

          <div className="font-ui" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
            {weekdayLabels.map((label, i) => (
              <div key={i} style={{ fontSize: 10, textAlign: "center", color: "var(--ink-dim)", padding: "4px 0", textTransform: "uppercase" }}>
                {label}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
              {week.map((day, di) => {
                if (!day) return null;
                const isStart = start && sameDay(day, start);
                const isEnd = end && sameDay(day, end);
                const inRange = start && end && day > start && day < end;
                const isToday = sameDay(day, today);
                const preview = isInPreviewRange(day) && !isStart;

                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => handleDayClick(day)}
                    onMouseEnter={() => setHoverDate(day)}
                    className="font-ui cal-day"
                    style={{
                      border: isToday && !isStart && !isEnd ? "1px solid var(--line)" : "none",
                      borderRadius: 6,
                      margin: 1,
                      padding: "7px 0",
                      fontSize: 12,
                      cursor: "pointer",
                      background: isStart || isEnd ? "var(--accent-green)" : inRange || preview ? "var(--bg-panel-raised)" : "transparent",
                      color: isStart || isEnd ? "var(--bg-panel)" : "var(--ink)",
                    }}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          ))}

          {start && !end && (
            <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 10 }}>
              {toLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
