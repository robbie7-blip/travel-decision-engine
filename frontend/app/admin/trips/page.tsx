// Password-protected (see middleware.ts): recent trips out of the Postgres
// archive, one line each - where, how long it took, what it cost, and what
// the quality gate found.
//
// The question this answers is "is generation healthy?" without paying
// for a test run to find out: real traffic is already the test. Each line
// opens the trip itself, where the admin-only diagnostics panel has the
// rest.
//
// Says WHETHER a trip was made signed in, never by whom (see
// listAdminTrips). The brief's private fields are not read at all.

import Link from "next/link";
import { getDb } from "@/lib/db";
import { MarkAdminUi } from "@/components/MarkAdminUi";
import { SendReportButton } from "@/components/SendReportButton";
import { AdminUnpublishButton } from "@/components/AdminUnpublishButton";
import { adminSummary, listAdminTrips, listPublished, listTripFeedback, type AdminSummary, type AdminTrip, type TripFeedbackRow } from "@/lib/tripsQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIMIT = 100;

function seconds(ms: number | null): string {
  return ms === null ? "-" : `${Math.round(ms / 1000)}s`;
}

function dollars(usd: number | null): string {
  return usd === null ? "-" : `$${usd.toFixed(2)}`;
}

function when(iso: string): string {
  // UTC, said so: the server's clock, not the reader's, and a list mixing
  // the two would be worse than either.
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "14px 18px", minWidth: 140 }}>
      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="font-display" style={{ fontSize: 28, fontWeight: 600 }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>{note}</div>}
    </div>
  );
}

function Quality({ trip }: { trip: AdminTrip }) {
  if (trip.status === "error") {
    return <span style={{ color: "var(--infeasible)" }}>failed{trip.error ? `: ${trip.error.slice(0, 80)}` : ""}</span>;
  }
  if (trip.passed === null) return <span style={{ color: "var(--ink-dim)" }}>-</span>;
  const head = (
    <span style={{ color: trip.passed ? "var(--grounded)" : "var(--infeasible)" }}>
      {trip.passed ? "pass" : "fail"} · {trip.defects ?? 0}d {trip.warnings ?? 0}w
      {trip.groundedPercent !== null ? ` · ${Math.round(trip.groundedPercent)}% checked` : ""}
    </span>
  );
  if (trip.defectDetails.length === 0) return head;
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>{head}</summary>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--ink-soft)" }}>
        {trip.defectDetails.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </details>
  );
}

export default async function TripsAdminPage({ searchParams }: { searchParams: Promise<{ tests?: string }> }) {
  const { tests } = await searchParams;
  const includeTests = tests !== "0";
  const db = getDb();

  let trips: AdminTrip[] = [];
  let summary: AdminSummary | null = null;
  let published: Awaited<ReturnType<typeof listPublished>> = [];
  let feedback: TripFeedbackRow[] = [];
  let error: string | null = null;
  if (db) {
    try {
      [trips, summary, published, feedback] = await Promise.all([
        listAdminTrips(db, LIMIT, includeTests),
        adminSummary(db),
        listPublished(db, 200).catch(() => []),
        listTripFeedback(db, 50).catch(() => []),
      ]);
    } catch (e) {
      // Shown, but with anything shaped like a connection string removed:
      // admin pages carry presence, never credentials.
      error = (e instanceof Error ? e.message : String(e)).replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection string]").slice(0, 200);
    }
  }

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 1100, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
      <Link href="/admin" style={{ color: "var(--grounded)", fontSize: 12, textDecoration: "none" }}>
        ← Admin
      </Link>
      <h1 className="font-display" style={{ fontSize: 24, margin: "10px 0 8px" }}>
        Trips
      </h1>

      {!db ? (
        <p style={{ color: "var(--ink-dim)" }}>No database on this deployment (DATABASE_URL is not set).</p>
      ) : error ? (
        <p style={{ color: "var(--infeasible)" }}>Could not read trips: {error}</p>
      ) : (
        <>
          {summary && (
            <>
              <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 10 }}>Last 7 days, real traffic only</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
                <Card label="Trips" value={String(summary.trips)} note={`${summary.refines} of them pushbacks`} />
                <Card
                  label="Passed quality"
                  value={summary.trips > 0 ? `${Math.round((summary.passed / summary.trips) * 100)}%` : "-"}
                  note={`${summary.failed} failed outright`}
                />
                <Card label="Median time" value={seconds(summary.medianMs)} />
                <Card label="Average cost" value={dollars(summary.avgCostUsd)} />
              </div>
            </>
          )}

          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 18 }}>
            Daily email (06:00 UTC, 8 or 9am in Sofia, to ADMIN_REPORT_EMAIL):{" "}
            <a href="/api/admin/daily-report" target="_blank" rel="noopener noreferrer" style={{ color: "var(--grounded)" }}>
              preview
            </a>{" "}
            · <SendReportButton />
          </div>

          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 8 }}>Published as public pages ({published.length})</div>
          {published.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 24 }}>None yet.</p>
          ) : (
            <ul style={{ fontSize: 12, margin: "0 0 24px", paddingLeft: 18 }}>
              {published.map((p) => (
                <li key={p.slug} style={{ marginBottom: 4 }}>
                  <Link href={`/plans/${p.slug}`} style={{ color: "var(--ink)" }}>
                    {p.title}
                  </Link>{" "}
                  <span style={{ color: "var(--ink-dim)" }}>{p.publishedAt.slice(0, 10)}</span> · <AdminUnpublishButton slug={p.slug} />
                </li>
              ))}
            </ul>
          )}

          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 8 }}>
            After the trip ({feedback.length}): answers to the &quot;How was your trip?&quot; email
          </div>
          {feedback.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 24 }}>None yet.</p>
          ) : (
            <ul style={{ fontSize: 12, margin: "0 0 24px", paddingLeft: 18 }}>
              {feedback.map((f) => (
                <li key={f.jobId} style={{ marginBottom: 6 }}>
                  <span style={{ color: f.rating === "great" ? "var(--grounded)" : f.rating === "bad" ? "var(--infeasible)" : "var(--ink)", fontWeight: 600 }}>
                    {f.rating === "great" ? "great" : f.rating === "ok" ? "ok" : "something wrong"}
                  </span>{" "}
                  <Link href={`/trip/${f.jobId}`} style={{ color: "var(--ink)" }}>
                    {f.destinations.join(" · ") || "(no city)"}
                  </Link>{" "}
                  <span style={{ color: "var(--ink-dim)" }}>
                    {f.language} · {f.updatedAt.slice(0, 10)}
                  </span>
                  {f.note && <div style={{ color: "var(--ink-soft)", whiteSpace: "pre-wrap", marginTop: 2 }}>{f.note}</div>}
                </li>
              ))}
            </ul>
          )}

          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 10 }}>
            Newest {LIMIT}, times in UTC ·{" "}
            {includeTests ? (
              <Link href="/admin/trips?tests=0" style={{ color: "var(--grounded)" }}>
                hide test runs
              </Link>
            ) : (
              <Link href="/admin/trips" style={{ color: "var(--grounded)" }}>
                show test runs
              </Link>
            )}
          </div>

          {trips.length === 0 ? (
            <p style={{ color: "var(--ink-dim)" }}>No trips stored yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--ink-dim)" }}>
                    {["When", "Trip", "Kind", "Days", "Time", "Cost", "Quality", ""].map((h) => (
                      <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", fontWeight: 500 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr key={trip.id} style={{ verticalAlign: "top" }}>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{when(trip.finishedAt)}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>
                        <Link href={`/trip/${trip.id}`} style={{ color: "var(--ink)" }}>
                          {trip.destinations.join(" · ") || "(no city)"}
                        </Link>
                        <div style={{ color: "var(--ink-dim)" }}>
                          {trip.language}
                          {trip.partySize ? ` · ${trip.partySize} ppl` : ""}
                          {trip.signedIn ? " · signed in" : ""}
                          {trip.testMode ? " · test" : ""}
                        </div>
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>{trip.kind === "refine" ? "pushback" : trip.kind === "edit" ? "hand edit" : "new"}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>{trip.dayCount ?? "-"}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>{seconds(trip.totalMs)}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>{dollars(trip.costUsd)}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>
                        <Quality trip={trip} />
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid var(--line)" }}>
                        <Link href={`/trip/${trip.id}`} style={{ color: "var(--grounded)" }}>
                          open →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
