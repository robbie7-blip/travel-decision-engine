"use client";

// The "Who" segment of the homepage search bar: four presets and a
// counter, in a popover. The rules for what each tap writes live in
// lib/partyPresets.ts; this is only the control.

import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "@/lib/i18n";
import {
  applyPreset,
  MAX_PARTY,
  PARTY_PRESETS,
  partySizeOf,
  presetOf,
  stepParty,
  travelerCount,
  type Party,
} from "@/lib/partyPresets";
import type { Language } from "@/lib/types";

interface WhoPickerProps {
  value: Party;
  onChange: (party: Party) => void;
  language: Language;
  t: Dictionary;
  /** Lets the search bar open this when the party is missing. */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

export function WhoPicker({ value, onChange, language, t, triggerRef }: WhoPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? ownTriggerRef;
  const copy = t.heroSearch;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, trigger]);

  const size = partySizeOf(value);
  const preset = presetOf(value.party_composition);
  const count = travelerCount(value, language);
  const display = count ? (preset ? `${count} · ${copy.presets[preset].label}` : count) : copy.travelersHeading;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="font-ui search-bare-trigger"
        aria-label={`${copy.who}: ${display}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{ color: count ? "var(--ink)" : "var(--ink-dim)" }}
      >
        {display}
      </button>

      {open && (
        <div className="date-popover who-popover font-ui" role="dialog" aria-label={copy.who}>
          <div className="who-presets">
            {PARTY_PRESETS.map((key) => (
              <button
                key={key}
                type="button"
                className="who-preset"
                aria-pressed={preset === key}
                onClick={() => onChange(applyPreset(value, key, language))}
              >
                {copy.presets[key].label}
              </button>
            ))}
          </div>

          <div className="who-count-row">
            <span className="who-count-label">{copy.travelersHeading}</span>
            <div className="who-stepper">
              <button
                type="button"
                className="who-step"
                aria-label={copy.fewer}
                disabled={size <= 1}
                onClick={() => onChange(stepParty(value, -1, language))}
              >
                −
              </button>
              <output className="who-count" aria-live="polite">
                {size || "-"}
              </output>
              <button
                type="button"
                className="who-step"
                aria-label={copy.more}
                disabled={size >= MAX_PARTY}
                onClick={() => onChange(stepParty(value, 1, language))}
              >
                +
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="who-done"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {copy.done}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
