"use client";

// The "Map Pins" Visualize tab — Been's per-place pins (a specific city or
// spot within a country you've visited), plotted on the same 3D globe as
// the "Globe" tab. A pin belongs to an already-visited country by design
// (you can click the globe to drop one, but not on a country that isn't
// marked visited yet) — "exactly where in a place you've been" only makes
// sense once "a place you've been" is already true.

import { useState, type CSSProperties } from "react";
import { VisitedGlobe, type GlobePin } from "./VisitedGlobe";
import { COUNTRIES, countryFlagEmoji, getCountry, getCountryName } from "@/lib/countries";
import type { VisitedEntry, VisitedPin } from "@/lib/localVisited";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface VisitedPinsPanelProps {
  entries: VisitedEntry[];
  onAddPin: (code: string, pin: Omit<VisitedPin, "id">) => void;
  onRemovePin: (code: string, pinId: string) => void;
  t: Dictionary["visited"];
  language: Language;
}

export function VisitedPinsPanel({ entries, onAddPin, onRemovePin, t, language }: VisitedPinsPanelProps) {
  const v = t.visualize;
  const visitedEntries = entries.filter((e) => getCountry(e.code) !== undefined);
  const visitedCountries = COUNTRIES.filter((c) => visitedEntries.some((e) => e.code === c.code))
    .map((c) => ({ ...c, displayName: getCountryName(c.code, language) }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, language));

  const [country, setCountry] = useState("");
  const [label, setLabel] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);

  const allPins: GlobePin[] = visitedEntries.flatMap((e) => (e.pins ?? []).map((p) => ({ ...p, code: e.code })));

  function handleGlobeClick(coords: { lat: number; lng: number }) {
    setLat(coords.lat.toFixed(4));
    setLng(coords.lng.toFixed(4));
  }

  function submit() {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!country || !label.trim() || !Number.isFinite(latNum) || !Number.isFinite(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      setError(true);
      return;
    }
    setError(false);
    onAddPin(country, { label: label.trim(), lat: latNum, lng: lngNum, ...(note.trim() ? { note: note.trim() } : {}) });
    setLabel("");
    setLat("");
    setLng("");
    setNote("");
  }

  if (visitedCountries.length === 0) {
    return <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink-dim)", fontSize: 14 }}>{v.pinsNeedVisitedCountry}</div>;
  }

  const inputStyle: CSSProperties = {
    background: "var(--bg-panel-raised)",
    border: "1px solid var(--line-strong)",
    borderRadius: 8,
    padding: "9px 12px",
    color: "var(--ink)",
    fontSize: 13,
    boxSizing: "border-box",
    width: "100%",
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div className="font-display" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}>
          {v.pinsHeading}
        </div>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", margin: "0 0 12px", lineHeight: 1.5 }}>{v.pinsBlurb}</p>
      </div>

      <VisitedGlobe
        visitedCodes={new Set(visitedEntries.map((e) => e.code))}
        visitedLabel={t.mapVisited}
        notVisitedLabel={t.mapNotVisited}
        untrackedLabel={t.mapUntracked}
        language={language}
        pins={allPins}
        onGlobeClick={handleGlobeClick}
      />

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          background: "var(--bg-panel)",
          border: "1px solid var(--line)",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <label style={{ gridColumn: "1 / -1" }}>
          <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>
            {v.pinFormCountryLabel}
          </div>
          <select value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle}>
            <option value="">{v.pinFormCountryPlaceholder}</option>
            {visitedCountries.map((c) => (
              <option key={c.code} value={c.code}>
                {countryFlagEmoji(c.code)} {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>
            {v.pinFormLabelLabel}
          </div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={v.pinFormLabelPlaceholder} style={inputStyle} />
        </label>
        <label>
          <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>
            {v.pinFormLatLabel}
          </div>
          <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="35.6595" style={inputStyle} />
        </label>
        <label>
          <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>
            {v.pinFormLngLabel}
          </div>
          <input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" placeholder="139.7005" style={inputStyle} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginBottom: 4 }}>
            {v.pinFormNoteLabel}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={v.pinFormNotePlaceholder} style={inputStyle} />
        </label>
        {error && (
          <div className="font-mono" style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--infeasible)" }}>
            {v.pinFormInvalid}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          className="font-mono btn-primary"
          style={{
            gridColumn: "1 / -1",
            padding: "10px 16px",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {v.pinFormSubmit}
        </button>
      </div>

      {allPins.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {allPins.map((pin) => {
            const c = getCountry(pin.code);
            return (
              <div
                key={pin.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 4px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <span style={{ fontSize: 18 }}>{countryFlagEmoji(pin.code)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 600 }}>{pin.label}</div>
                  <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                    {c ? getCountryName(c.code, language) : ""} · {pin.lat.toFixed(2)}, {pin.lng.toFixed(2)}
                    {pin.note ? ` · ${pin.note}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemovePin(pin.code, pin.id)}
                  className="font-mono"
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 999,
                    padding: "5px 12px",
                    fontSize: 11,
                    background: "transparent",
                    color: "var(--infeasible)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {v.pinRemove}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
