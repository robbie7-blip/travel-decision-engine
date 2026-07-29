"use client";

import { useEffect, useState } from "react";
import { getRecentTrips, removeRecentTrip, type RecentTrip } from "@/lib/recentTrips";
import { SectionLabel } from "./ui";
import type { Dictionary } from "@/lib/i18n";

/** Renders nothing until after mount (localStorage isn't available during
 * SSR, and reading it during render would create a hydration mismatch
 * anyway) and nothing at all once mounted if the list is empty — a
 * first-time visitor sees no trace of this section. */
export function RecentTrips({ t }: { t: Dictionary }) {
  const [trips, setTrips] = useState<RecentTrip[] | null>(null);

  useEffect(() => {
    setTrips(getRecentTrips());
  }, []);

  if (!trips || trips.length === 0) return null;

  function handleRemove(jobId: string) {
    removeRecentTrip(jobId);
    setTrips((prev) => prev?.filter((trip) => trip.jobId !== jobId) ?? prev);
  }

  return (
    <div style={{ marginTop: 22 }}>
      <SectionLabel>{t.recentTrips.heading}</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {trips.map((trip) => (
          <div
            key={trip.jobId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--line)",
              borderRadius: 999,
              padding: "6px 8px 6px 14px",
            }}
          >
            <a
              href={`/trip/${trip.jobId}`}
              className="font-mono"
              style={{ fontSize: 12, color: "var(--ink)", textDecoration: "none" }}
            >
              {trip.destinations.join(" · ")}{" "}
              <span style={{ color: "var(--ink-dim)" }}>
                · {trip.startDate} → {trip.endDate}
              </span>
            </a>
            <button
              type="button"
              onClick={() => handleRemove(trip.jobId)}
              aria-label={t.recentTrips.remove}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--ink-dim)",
                fontSize: 15,
                lineHeight: 1,
                padding: 2,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
