import { Dot, SectionLabel, Stamp } from "./ui";
import type { Itinerary } from "@/lib/types";

export function ItineraryResult({ result }: { result: Itinerary }) {
  return (
    <div>
      {result.budget_feasibility && (
        <div style={{ marginBottom: 24 }}>
          <Stamp ok={result.budget_feasibility.feasible}>
            {result.budget_feasibility.feasible ? "Budget: feasible" : "Budget: not feasible as stated"}
          </Stamp>
          <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
            Model&apos;s minimum estimate: €{result.budget_feasibility.min_realistic_total_eur} —{" "}
            {result.budget_feasibility.reasoning}
          </p>
        </div>
      )}

      {result._budget_integrity_warnings && result._budget_integrity_warnings.length > 0 && (
        <div
          className="font-mono"
          style={{
            border: "1px solid var(--infeasible)",
            borderRadius: 6,
            padding: "12px 16px",
            marginBottom: 24,
            fontSize: 12,
            color: "var(--infeasible)",
          }}
        >
          {result._budget_integrity_warnings.map((w, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      <h2
        className="font-display"
        style={{
          fontWeight: 600,
          fontSize: 22,
          lineHeight: 1.4,
          margin: "0 0 28px",
          color: "var(--ink)",
        }}
      >
        {result.trip_summary}
      </h2>

      {result.key_decisions && result.key_decisions.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <SectionLabel>Key decisions</SectionLabel>
          {result.key_decisions.map((d, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 0",
                borderTop: "1px solid var(--line)",
              }}
            >
              <div
                className="font-mono"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  color:
                    d.confidence === "high"
                      ? "var(--grounded)"
                      : d.confidence === "medium"
                        ? "var(--unverified)"
                        : "var(--ink-dim)",
                  width: 50,
                  flexShrink: 0,
                  paddingTop: 3,
                }}
              >
                {d.confidence}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{d.decision}</div>
                <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 3 }}>{d.reasoning}</div>
                {d.alternative_considered && (
                  <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 3, fontStyle: "italic" }}>
                    vs: {d.alternative_considered}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.days &&
        result.days.map((day) => (
          <div key={day.day} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <span className="font-display" style={{ fontSize: 18, fontWeight: 600 }}>
                Day {String(day.day).padStart(2, "0")}
              </span>
              <span className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {day.date}
              </span>
              {day.feasibility_flag && (
                <span className="font-mono" style={{ fontSize: 11, color: "var(--unverified)" }}>
                  ⚠ {day.feasibility_flag}
                </span>
              )}
            </div>
            {day.items.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 4,
                  padding: "10px 0",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <Dot grounded={item.source_confidence === "grounded"} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{item.title}</span>
                    <span className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      €{item.cost_estimate_eur}
                      {item.source_confidence !== "grounded" && " (unverified)"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 2 }}>
                    {item.location} · {item.time}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4, color: "#c8c5b8" }}>{item.reasoning}</div>
                  {item.source_urls && item.source_urls.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginTop: 4,
                      }}
                    >
                      {item.source_urls.map((url, si) => (
                        <a
                          key={si}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono"
                          style={{
                            fontSize: 11,
                            color: "var(--grounded)",
                            textDecoration: "underline",
                          }}
                        >
                          {item.source_urls!.length > 1 ? `source ${si + 1}` : "source"} ↗
                        </a>
                      ))}
                      {item.source_agreement === "disagree" && (
                        <span className="font-mono" style={{ fontSize: 11, color: "var(--unverified)" }}>
                          ⚠ sources disagree
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

      {result.things_to_skip && result.things_to_skip.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <SectionLabel>Skip this</SectionLabel>
          {result.things_to_skip.map((s, i) => (
            <div key={i} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--infeasible)" }}>{s.item}</span>
              <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>{s.reasoning}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
