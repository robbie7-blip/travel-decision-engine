"use client";

// Paste a booking confirmation, get your own flights back, and fill in the
// visited-countries map from them instead of ticking countries off by hand.
//
// Two deliberate behaviours worth keeping:
//
// - Nothing is written until the traveler confirms. Extraction from a messy
//   real-world email is the part most likely to be imperfect, so the result
//   is shown as a reviewable list rather than applied silently. Getting a
//   country wrong here would corrupt a record someone has built up over
//   years.
// - Future flights are listed but never pre-selected. A forwarded upcoming
//   booking is a plan, not a visit, and quietly marking it visited would be
//   wrong in a way that's hard to notice later.

import { useState } from "react";
import { MAX_FLIGHT_IMPORT_CHARS, type FlightImportResult, type ImportedFlight } from "@/lib/flightImport";
import { countryFlagEmoji, getCountryName } from "@/lib/countries";
import type { Language } from "@/lib/types";

interface Props {
  signedIn: boolean;
  language: Language;
  /** Applies the confirmed flights: one entry per country, dated with the
   * earliest confirmed arrival there. */
  onImport: (visits: { code: string; visitedAt: string }[]) => void;
}

export function FlightImport({ signedIn, language, onImport }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flights, setFlights] = useState<ImportedFlight[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [done, setDone] = useState("");

  async function extract() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    setDone("");
    setFlights(null);
    try {
      const res = await fetch("/api/flight-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Couldn't read that email.");
      const result = data as FlightImportResult;
      if (result.flights.length === 0) {
        setError("No flights found in that text. Paste the full confirmation email, including the flight details.");
        return;
      }
      setFlights(result.flights);
      // Past flights only — see the header comment.
      setSelected(new Set(result.flights.map((f, i) => (f.isPast ? i : -1)).filter((i) => i >= 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that email.");
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!flights) return;
    const earliestByCountry = new Map<string, string>();
    for (const i of selected) {
      const f = flights[i];
      if (!f) continue;
      const current = earliestByCountry.get(f.arrivalCountryCode);
      if (!current || f.date < current) earliestByCountry.set(f.arrivalCountryCode, f.date);
    }
    const visits = [...earliestByCountry].map(([code, visitedAt]) => ({ code, visitedAt }));
    onImport(visits);
    setDone(
      visits.length === 1
        ? "Added 1 country from that booking."
        : `Added ${visits.length} countries from that booking.`
    );
    setFlights(null);
    setSelected(new Set());
    setText("");
  }

  if (!signedIn) return null;

  const box = {
    border: "1px solid var(--line)",
    borderRadius: 8,
    background: "var(--bg-panel)",
    padding: "12px 14px",
  } as const;

  return (
    <div style={{ marginBottom: 18 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 999,
          background: "transparent",
          color: "var(--ink-soft)",
          padding: "7px 14px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        ✈ Import from a booking email {open ? "▲" : "▼"}
      </button>

      {open && (
        <div style={{ ...box, marginTop: 10 }}>
          <p style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 10px" }}>
            Paste a flight confirmation email and we&apos;ll pull out the trips and tick off the countries. Only
            your own bookings, and nothing is added until you confirm below. We don&apos;t store the email — it&apos;s
            used to read the flights and then it&apos;s gone.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_FLIGHT_IMPORT_CHARS))}
            placeholder="Paste the whole confirmation email here..."
            rows={5}
            className="font-mono"
            style={{
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--bg-panel-raised)",
              color: "var(--ink)",
              fontSize: 12,
            }}
          />

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={extract}
              disabled={busy || !text.trim()}
              className="font-mono btn-primary"
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: busy || !text.trim() ? "default" : "pointer",
              }}
            >
              {busy ? "Reading..." : "Find my flights"}
            </button>
            {done && <span className="font-mono" style={{ fontSize: 12, color: "var(--accent-green)" }}>{done}</span>}
            {error && <span className="font-mono" style={{ fontSize: 12, color: "var(--infeasible)" }}>{error}</span>}
          </div>

          {flights && (
            <div style={{ marginTop: 14 }}>
              <div
                className="font-mono"
                style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 8 }}
              >
                Found {flights.length} flight{flights.length === 1 ? "" : "s"} — check what to add
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {flights.map((f, i) => (
                  <label
                    key={`${f.date}-${f.arrivalIata}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 13,
                      padding: "7px 10px",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      background: "var(--bg-panel-raised)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setSelected(next);
                      }}
                    />
                    <span>{countryFlagEmoji(f.arrivalCountryCode)}</span>
                    <span style={{ flex: 1 }}>
                      {f.departureCity || f.departureIata} → {f.arrivalCity}{" "}
                      <span className="font-mono" style={{ color: "var(--ink-dim)", fontSize: 11 }}>
                        {f.date}
                        {f.airline ? ` · ${f.airline}` : ""}
                      </span>
                    </span>
                    <span className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                      {getCountryName(f.arrivalCountryCode, language)}
                    </span>
                    {!f.isPast && (
                      <span className="font-mono" style={{ fontSize: 10, color: "var(--unverified)" }}>
                        upcoming
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={confirm}
                disabled={selected.size === 0}
                className="font-mono btn-primary"
                style={{
                  marginTop: 10,
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: selected.size === 0 ? "default" : "pointer",
                }}
              >
                Add to my map
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
