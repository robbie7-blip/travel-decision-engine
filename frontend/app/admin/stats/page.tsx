// Password-protected (see middleware.ts) internal view of self-hosted usage
// counters (see lib/analytics.ts). Reads directly from Redis — no separate
// API route, since this is the only consumer, same pattern as
// admin/feedback/page.tsx.

import Link from "next/link";
import { getRedis } from "@/lib/redis";
import { loadAnalyticsSnapshot, loadFunnelSnapshot, type AnalyticsSnapshot, type FunnelSnapshot } from "@/lib/analytics";
import { checkDailyBudget, type BudgetCheckResult } from "@/lib/spendCheck";
import { ALERT_THRESHOLD_RATIO } from "@/lib/costBudget";
import { loadQualitySnapshot, QUALITY_CHECKS, type QualitySnapshot } from "@/lib/qualityStats";
import { MarkAdminUi } from "@/components/MarkAdminUi";

export const dynamic = "force-dynamic"; // always fresh, never statically cached
export const runtime = "nodejs";

async function loadSnapshot(): Promise<{
  analytics: AnalyticsSnapshot;
  funnel: FunnelSnapshot;
  budget: BudgetCheckResult;
  quality: QualitySnapshot;
} | null> {
  let redis;
  try {
    redis = getRedis();
  } catch {
    return null;
  }
  const [analytics, funnel, budget, quality] = await Promise.all([
    loadAnalyticsSnapshot(redis),
    loadFunnelSnapshot(redis),
    checkDailyBudget(redis),
    loadQualitySnapshot(redis),
  ]);
  return { analytics, funnel, budget, quality };
}

export default async function StatsAdminPage() {
  const loaded = await loadSnapshot();

  if (!loaded) {
    return (
      <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
        <h1 className="font-display" style={{ fontSize: 24, marginBottom: 8 }}>
          Stats
        </h1>
        <p style={{ color: "var(--ink-dim)" }}>Server is misconfigured (job queue is not set up).</p>
      </div>
    );
  }

  const { analytics: snapshot, funnel, budget, quality } = loaded;
  // Percentage of `from` that reached `to` — null (rendered as "—") rather
  // than a misleading 0% or NaN when the denominator is 0 (no data yet).
  const rate = (from: number, to: number): string => (from > 0 ? `${Math.round((to / from) * 100)}%` : "—");
  const maxDaily = Math.max(1, ...snapshot.daily.map((d) => d.generate + d.refine));
  // Mirrors the worker's own early-warning threshold (see
  // maybeAlertBudgetThreshold in worker/src/index.ts) so this page's color
  // and that alert agree on what "nearing the cap" means.
  const budgetNearLimit = budget.limitUsd > 0 && budget.spentUsd / budget.limitUsd >= ALERT_THRESHOLD_RATIO;
  const budgetColor = !budget.allowed ? "var(--infeasible)" : budgetNearLimit ? "var(--unverified)" : "var(--ink)";

  return (
    <div className="font-mono" style={{ padding: "32px 24px", maxWidth: 900, margin: "0 auto", color: "var(--ink)" }}>
      <MarkAdminUi />
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
          <div className="font-display" style={{ fontSize: 32, fontWeight: 600, color: budgetColor }}>
            ${budget.spentUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
            of ${budget.limitUsd.toFixed(2)} budget
            {!budget.allowed ? " — new generations paused" : budgetNearLimit ? " — nearing cap" : ""}
          </div>
        </div>
      </div>

      {/* What the acceptance gate found across REAL generations — see
          worker/src/engine/quality.ts. This section exists because the only
          previous detector for a quality regression was the owner opening a
          trip and noticing something wrong, which made every quality
          question cost a paid generation to ask. Traveler traffic answers
          it for free now, and continuously. */}
      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        Generation quality — last 30 days
      </div>
      {quality.jobs === 0 ? (
        <div style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 32 }}>
          No generations recorded yet. This fills in on its own as trips are generated.
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Clean generations
              </div>
              <div
                className="font-display"
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color:
                    quality.passed / quality.jobs >= 0.9
                      ? "var(--accent-green)"
                      : quality.passed / quality.jobs >= 0.7
                        ? "var(--unverified)"
                        : "var(--infeasible)",
                }}
              >
                {Math.round((quality.passed / quality.jobs) * 100)}%
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                {quality.passed} of {quality.jobs} shipped with no defect
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Avg grounded
              </div>
              <div
                className="font-display"
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color: quality.avgGroundedPercent >= 60 ? "var(--accent-green)" : "var(--unverified)",
                }}
              >
                {quality.avgGroundedPercent}%
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
                of line items, averaged per trip
              </div>
            </div>
          </div>

          {/* Ordered by how often each fired, so the thing most worth fixing
              is the thing at the top. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {QUALITY_CHECKS.map((check) => ({ ...check, count: quality.byCheck[check.id] ?? 0 }))
              .sort((a, b) => b.count - a.count)
              .map((check) => {
                const share = quality.jobs > 0 ? check.count / quality.jobs : 0;
                return (
                  <div key={check.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                    <span style={{ flex: "0 0 200px", color: check.count === 0 ? "var(--ink-dim)" : "var(--ink)" }}>
                      {check.label}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: "var(--bg-panel-raised)",
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${Math.round(share * 100)}%`,
                          background: share >= 0.25 ? "var(--infeasible)" : "var(--unverified)",
                        }}
                      />
                    </span>
                    <span style={{ flex: "0 0 90px", textAlign: "right", color: "var(--ink-dim)", fontSize: 12 }}>
                      {check.count} ({Math.round(share * 100)}%)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Where visitors actually drop off, not a guess — see
          lib/analytics.ts's FunnelEventType. Totals since these counters
          were added, not lifetime (there was no visibility before this). */}
      <div style={{ fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        Conversion funnel
      </div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "16px 20px", marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>Pricing page views: {funnel.pricing_view}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>
            → Checkout started: {funnel.checkout_started}{" "}
            <span style={{ color: "var(--ink-dim)" }}>({rate(funnel.pricing_view, funnel.checkout_started)} of views)</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 13 }}>
            → Checkout completed: {funnel.checkout_completed}{" "}
            <span style={{ color: "var(--ink-dim)" }}>
              ({rate(funnel.checkout_started, funnel.checkout_completed)} of checkouts started)
            </span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: "var(--unverified)" }}>Subscriptions canceled: {funnel.subscription_canceled}</span>
        </div>
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", gap: 20, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>Free quota hit: {funnel.quota_blocked_free}</span>
          <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>Pro quota hit: {funnel.quota_blocked_paid}</span>
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
