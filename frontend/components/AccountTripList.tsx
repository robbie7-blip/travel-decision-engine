"use client";

// "Your trips" on the account page: every finished trip this account has
// planned, on whichever device it was planned on (/api/account/trips).

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchAccountTrips } from "@/lib/api";
import type { AccountTrip } from "@/lib/recentTrips";
import type { Dictionary } from "@/lib/i18n";

export function AccountTripList({ t }: { t: Dictionary }) {
  const [trips, setTrips] = useState<AccountTrip[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountTrips().then((list) => {
      if (!cancelled) setTrips(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (trips === null) return null;

  return (
    <section className="account-trips" aria-labelledby="account-trips-heading">
      <h2 id="account-trips-heading" className="font-display account-trips-heading">
        {t.account.myTripsHeading}
      </h2>
      {trips.length === 0 ? (
        <p className="font-ui account-trips-empty">{t.account.myTripsEmpty}</p>
      ) : (
        <ul className="account-trips-list">
          {trips.map((trip) => (
            <li key={trip.jobId}>
              <Link href={`/trip/${trip.jobId}`} className="account-trip">
                <span className="font-display account-trip-places">{trip.destinations.join(" · ")}</span>
                {trip.startDate && (
                  <span className="font-ui account-trip-dates">
                    {trip.startDate} → {trip.endDate}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
