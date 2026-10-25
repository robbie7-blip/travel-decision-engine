"use client";

// "Where are you staying?" with Google Maps suggestions (/api/lodging-
// search), centred on the trip's first destination. Picking one writes
// "name, address" into the brief, so the plan is built around the real
// place rather than a name the model has to guess the location of.
// Anything typed still goes in as it is: an address, a friend's flat, or a
// place Google does not know.

import { useEffect, useId, useRef, useState } from "react";
import type { Language } from "@/lib/types";

interface Suggestion {
  name: string;
  address: string;
}

interface LodgingComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** The trip's first destination, to search near. */
  near: string;
  language: Language;
  placeholder: string;
  inputStyle: React.CSSProperties;
}

const cache = new Map<string, Suggestion[]>();

export function LodgingCombobox({ value, onChange, near, language, placeholder, inputStyle }: LodgingComboboxProps) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{ key: string; list: Suggestion[] }>({ key: "", list: [] });
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = value.trim();
  const key = `${language}|${near}|${q.toLowerCase()}`;

  useEffect(() => {
    if (!open || q.length < 3) return;
    const cached = cache.get(key);
    if (cached) {
      setResults({ key, list: cached });
      return;
    }
    const controller = new AbortController();
    // Longer pause than the city field: each answer is a paid Google call,
    // so one per pause in typing rather than one per letter.
    const timer = setTimeout(() => {
      fetch(`/api/lodging-search?${new URLSearchParams({ q, near, lang: language })}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data: { suggestions?: Suggestion[] }) => {
          const list = Array.isArray(data.suggestions) ? data.suggestions : [];
          cache.set(key, list);
          setResults({ key, list });
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, key, q, near, language]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const suggestions = results.key === key && q.length >= 3 ? results.list : [];
  const label = (s: Suggestion) => (s.address ? `${s.name}, ${s.address}` : s.name);

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
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            // Enter inside a form submits it.
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
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {suggestions.map((s) => (
            <button
              key={label(s)}
              type="button"
              // onMouseDown, not onClick, as in the city fields: the input's
              // own handlers would otherwise run first.
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(label(s));
                setOpen(false);
              }}
              role="option"
              aria-selected={label(s) === q}
              className="font-ui cal-day"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                borderRadius: 6,
                padding: "8px 10px",
                cursor: "pointer",
                background: "transparent",
                color: "var(--ink)",
              }}
            >
              <span style={{ display: "block", fontSize: 13 }}>{s.name}</span>
              {s.address && <span style={{ display: "block", fontSize: 12, color: "var(--ink-dim)" }}>{s.address}</span>}
            </button>
          ))}
          <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", padding: "6px 10px 2px" }}>
            Google Maps
          </div>
        </div>
      )}
    </div>
  );
}
