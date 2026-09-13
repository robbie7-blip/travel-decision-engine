"use client";

// The destinations field: chosen cities as removable chips, plus one input
// that suggests as you type.
//
// A <select> was the obvious reading of "make it a dropdown too", and it is
// the one thing this field cannot be. The airport dropdown works because its
// question is closed - Rome has two airports and lib/airports.ts knows both.
// "Where are you going" is not closed, and a closed list would mean the
// engine can no longer plan the trip to Tbilisi that is its whole premise.
//
// So: suggestions that behave like a dropdown when the city is on the list,
// and a plain text field when it is not. Enter or comma commits whatever has
// been typed, which is what the field did before, so nothing that worked
// stops working.
//
// The VALUE stays one comma-separated string, unchanged. validation.ts
// splits it that way, the ?dest= deep link from the guide pages sets it that
// way, and flight import writes it that way - the chips are a view over that
// string, not a new shape.

import { useEffect, useId, useRef, useState } from "react";
import { inputStyle } from "./ui";
import { addCity, cityLabel, filterCityOptions, joinCities, splitCities } from "@/lib/cityOptions";
import type { Language } from "@/lib/types";

interface CityComboboxProps {
  /** The comma-separated destinations string, exactly as the form holds it. */
  value: string;
  onChange: (value: string) => void;
  language: Language;
  placeholder: string;
  /** Shown once at least one chip exists, so the box below them does not
   * read as an empty field with no purpose. */
  addMorePlaceholder: string;
  removeLabel: string;
  /** Shown under the input when what has been typed matches no suggestion,
   * so the free-text path is discoverable rather than a thing you have to
   * guess works. */
  freeTextHint: string;
}

export function CityCombobox({
  value,
  onChange,
  language,
  placeholder,
  addMorePlaceholder,
  removeLabel,
  freeTextHint,
}: CityComboboxProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // A combobox has to name the list it controls, and a page can hold two of
  // these (the trip form and the compare field), so the id cannot be a
  // constant.
  const listId = useId();

  const cities = splitCities(value);
  const suggestions = filterCityOptions(draft, language, cities);

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
    const next = addCity(cities, city);
    // addCity refuses duplicates, so this is also the "you already added
    // Rome" path - the draft clears either way rather than leaving text
    // sitting there looking unsubmitted.
    onChange(joinCities(next));
    setDraft("");
    setOpen(false);
  }

  function remove(city: string) {
    onChange(joinCities(cities.filter((existing) => existing !== city)));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      // Enter inside a form submits it, and a half-typed city is not a
      // trip request.
      e.preventDefault();
      if (draft.trim()) commit(draft);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    // Backspace on an empty draft removes the last chip - the behaviour
    // every chip field has, and the only way to undo a mis-click without
    // aiming at a small ×.
    if (e.key === "Backspace" && draft === "" && cities.length > 0) {
      remove(cities[cities.length - 1]);
    }
  }

  // A paste of "Brussels, Bruges" is the shape this field's old placeholder
  // asked for, so it still works: split on commas and commit each.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes(",")) return;
    e.preventDefault();
    let next = cities;
    for (const part of splitCities(pasted)) next = addCity(next, part);
    onChange(joinCities(next));
    setDraft("");
  }

  const showHint = draft.trim().length > 0 && suggestions.length === 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {cities.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 7 }}>
          {cities.map((city) => (
            <span
              key={city}
              className="font-ui"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--bg-panel-raised)",
                border: "1px solid var(--line)",
                borderRadius: 999,
                padding: "4px 6px 4px 11px",
                fontSize: 13,
              }}
            >
              {city}
              <button
                type="button"
                // onPointerDown, not onClick, and this is not a style choice.
                //
                // Removing a chip on click removed TWO cities from one
                // click. Reproduced with a raw single mousedown/mouseup in
                // Chromium, and the event log says why: the gesture
                // produces two native click events -
                //
                //   pointerdown:Remove Tbilisi  mousedown:Remove Tbilisi
                //   mouseup:Remove Tbilisi      click:Remove Tbilisi
                //   focusout:Remove Tbilisi     click:Remove Rome
                //
                // The first click removes Tbilisi, the chip row reflows
                // under the stationary pointer, and the second activation
                // lands on whichever chip has slid into that spot - here
                // the one to its left. Every chip field with this layout
                // has this hazard; ours put it next to a field where the
                // silent loss is a whole destination.
                //
                // Handling pointerdown ends the gesture before the row can
                // move: the stray second click arrives at a button whose
                // only handler never fires for it.
                onPointerDown={(e) => {
                  e.preventDefault();
                  remove(city);
                }}
                aria-label={`${removeLabel} ${city}`}
                className="cal-nav"
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--ink-soft)",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "0 2px",
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        style={inputStyle}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => {
          // Whatever is typed when focus leaves is a city the traveller
          // meant. Without this, tabbing on after typing "Tbilisi" silently
          // discarded it - and the one destination that is NOT on the
          // suggestion list is exactly the one that would be lost.
          if (draft.trim()) commit(draft);
        }}
        placeholder={cities.length > 0 ? addMorePlaceholder : placeholder}
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
              // onMouseDown, not onClick: the input's onBlur fires first on
              // a click and would commit the half-typed draft instead of the
              // option that was actually aimed at.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(option.name);
              }}
              role="option"
              aria-selected={false}
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
                background: "transparent",
                color: "var(--ink)",
              }}
            >
              <span>{cityLabel(option, language)}</span>
              <span style={{ color: "var(--ink-dim)", fontSize: 12 }}>{option.country}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
