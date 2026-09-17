"use client";

// "Traveling from", as the same control the destinations field is.
//
// It was a bare text input sitting directly under a chip-and-suggestions
// combobox, which asks the same kind of question - name a city - and
// answers it two different ways on one screen. That is the plain UI rule:
// the same question gets the same control, or the traveler has to learn the
// form twice. Nothing about "where are you leaving from" is more open-ended
// than "where are you going".
//
// SINGLE-VALUE, not a chip field. You leave from one place, so chips would
// invite a list the brief has no room for (TripBriefInput.origin is one
// optional string) and the form's own value stays exactly that string - no
// splitting, no joining, nothing downstream changes.
//
// Free text still works, for the same reason CityCombobox allows it: the
// suggestion list is ~100 cities and the engine's whole premise is planning
// the trip from somewhere that is not on anybody's list. Typing a city that
// does not match simply keeps what was typed.

import { useEffect, useId, useRef, useState } from "react";
import { inputStyle } from "./ui";
import { cityLabel, filterCityOptions } from "@/lib/cityOptions";
import type { Language } from "@/lib/types";

interface OriginComboboxProps {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  placeholder: string;
  /** Shown under the field when what has been typed matches no suggestion,
   * so the free-text path is discoverable rather than something you have to
   * guess works. Same wording as the destinations field. */
  freeTextHint: string;
}

export function OriginCombobox({ value, onChange, language, placeholder, freeTextHint }: OriginComboboxProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // No `chosen` exclusion: this field holds one city, and excluding the
  // current value would empty the list the moment a suggestion is picked -
  // so reopening it to change your mind would show nothing.
  const suggestions = filterCityOptions(value, language);

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

  function commit(city: string) {
    onChange(city);
    setOpen(false);
  }

  // An exact match is not "nothing matched", even when the suggestion list
  // is empty for some other reason - so the hint keys off there being a
  // query with no candidates rather than off the list length alone.
  const showHint = value.trim().length > 0 && suggestions.length === 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        style={inputStyle}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (e.key === "Enter") {
            // Enter inside a form submits it, and this field being focused
            // with a list open is not a trip request.
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
      />

      {showHint && (
        <div className="font-ui" style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 5 }}>
          {freeTextHint}
        </div>
      )}

      {open && suggestions.length > 0 && (
        <div
          id={listId}
          role="listbox"
          className="date-popover"
          style={{
            position: "absolute",
            zIndex: 20,
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            background: "var(--bg-panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: 8,
            boxShadow: "0 8px 24px -8px rgba(43, 36, 28, 0.25)",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {suggestions.map((option) => (
            <button
              key={option.name}
              type="button"
              // onMouseDown, not onClick - same reason as the destinations
              // field: on a click the input's own handlers fire first, and
              // aiming at an option should land on the option.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(option.name);
              }}
              role="option"
              aria-selected={option.name === value.trim()}
              className="font-ui cal-day"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                width: "100%",
                textAlign: "left",
                border: "none",
                borderRadius: 6,
                padding: "7px 10px",
                fontSize: 13,
                cursor: "pointer",
                background: option.name === value.trim() ? "var(--accent-green)" : "transparent",
                color: option.name === value.trim() ? "var(--bg-panel)" : "var(--ink)",
              }}
            >
              <span>{cityLabel(option, language)}</span>
              <span
                style={{
                  color: option.name === value.trim() ? "var(--bg-panel)" : "var(--ink-dim)",
                  fontSize: 12,
                }}
              >
                {option.country}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
