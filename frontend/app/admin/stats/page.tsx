// Password-protected (see middleware.ts) internal view of self-hosted usage
// counters (see lib/analytics.ts). Reads directly from Redis — no separate
// API route, since this is the only consumer, same pattern as
// admin/feedback/page.tsx.

import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { loadAnalyticsSnapshot, type AnalyticsSnapshot } from "@/lib/analytics";
import { checkDailyBudget, type BudgetCheckResult } from "@/lib/spendCheck";

export const dynamic = "force-dynamic"; // always fresh, never statically cached
export const runtime = "nodejs";

async function loadSnapshot(): Promise<{ analytics: AnalyticsSnapshot; budget: BudgetCheckResult } | null> {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return null;
  }
  const [analytics, budget] = await Promise.all([loadAnalyticsSnapshot(redis), checkDailyBudget(redis)]);
  return { analytics, budget };
}

export default async function StatsAdminPage() {
  const loaded = await loadSnapshot();

  if (!loaded) {
    return (
      <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto", color: "var(--ink)" }}>
        <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
          Stats
        </h1>
        <p style={{ color: "var(--ink-dim)" }}>Server is misconfigured (job queue is not set up).</p>
      </div>
    );
  }

  const { analytics: snapshot, budget } = loaded;
  const maxDaily = Math.max(1, ...snapshot.daily.map((d) => d.generate + d.refine));

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto", color: "var(--ink)" }}>
      <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
        Stats
      </h1>
      <div style={{ color: "var(--ink-dim)", fontSize: 13, marginBottom: 24 }}>
        <Link href="/admin/feedback" style={{ color: "var(--grounded)" }}>
          feedback →
        </Link>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
        <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 20px", minWidth: 160 }}>
          <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Generations
          </div>
          <div className="font-display" style={{ fontSize: 32, fontWeight: 600 }}>
            {snapshot.generateTotal}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            {snapshot.generateByLang.en} en · {snapshot.generateByLang.bg} bg
          </div>
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 20px", minWidth: 160 }}>
          <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Pushbacks
          </div>
          <div className="font-display" style={{ fontSize: 32, fontWeight: 600 }}>
            {snapshot.refineTotal}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            {snapshot.refineByLang.en} en · {snapshot.refineByLang.bg} bg
          </div>
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 20px", minWidth: 160 }}>
          <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Today&apos;s spend
          </div>
          <div
            className="font-display"
            style={{ fontSize: 32, fontWeight: 600, color: budget.allowed ? "var(--ink)" : "var(--tier-inferred, #b8433a)" }}
          >
            ${budget.spentUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            of ${budget.limitUsd.toFixed(2)} budget{!budget.allowed ? " — new generations paused" : ""}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        Last {snapshot.daily.length || 0} days with activity
      </div>

      {snapshot.daily.length === 0 && <p style={{ color: "var(--ink-dim)" }}>No activity yet.</p>}

      {snapshot.daily.map((d) => (
        <div key={d.day} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <div style={{ width: 90, fontSize: 12, color: "var(--ink-dim)", flexShrink: 0 }}>{d.day}</div>
          <div style={{ flex: 1, display: "flex", height: 14, borderRadius: 3, overflow: "hidden", background: "var(--bg-panel-raised)" }}>
            <div style={{ width: `${(d.generate / maxDaily) * 100}%`, background: "var(--grounded)" }} />
            <div style={{ width: `${(d.refine / maxDaily) * 100}%`, background: "var(--tier-single-source)" }} />
          </div>
          <div style={{ width: 90, fontSize: 12, color: "var(--ink-dim)", flexShrink: 0, textAlign: "right" }}>
            {d.generate} + {d.refine}
          </div>
        </div>
      ))}
    </div>
  );
}
