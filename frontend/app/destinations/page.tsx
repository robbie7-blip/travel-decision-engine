import type { Metadata } from "next";
import { listDestinations } from "@/lib/destinations";

const title = "Destination guides — decide";
const description = "What decide already knows about 18 cities before it even runs a live search.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description },
  twitter: { title, description },
};

export default function DestinationsIndexPage() {
  const destinations = listDestinations().sort((a, b) => a.city.localeCompare(b.city));

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
        <div
          style={{
            maxWidth: 780,
            margin: "0 auto",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
          }}
        >
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
            <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--ink)" }}>
              decide
            </span>
          </a>
        </div>
      </div>

      <div style={{ padding: "40px 24px 72px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          <h1
            className="font-display"
            style={{ fontWeight: 600, fontSize: "clamp(28px, 4.5vw, 38px)", lineHeight: 1.2, margin: "0 0 14px", color: "var(--ink)" }}
          >
            Destination guides
          </h1>
          <p style={{ color: "var(--ink-dim)", fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: "0 0 12px" }}>
            Local notes decide already has on hand for these {destinations.length} cities — real costs, how to get
            around, and what to skip — before a live search ever runs.
          </p>
          <p className="font-mono" style={{ color: "var(--ink-dim)", fontSize: 12, lineHeight: 1.6, marginBottom: 36 }}>
            Not on this list? decide plans anywhere — these are just a head start.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
            {destinations.map((d) => (
              <a
                key={d.slug}
                href={`/destinations/${d.slug}`}
                className="hover-card"
                style={{
                  display: "block",
                  padding: "16px 18px",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div className="font-display" style={{ fontSize: 19, fontWeight: 600, color: "var(--ink)" }}>
                  {d.city}
                </div>
                <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                  {d.facts.length} local notes
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
