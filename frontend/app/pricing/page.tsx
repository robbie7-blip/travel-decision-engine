"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { FREE_MONTHLY_GENERATIONS, PAID_MONTHLY_GENERATIONS } from "@/lib/planLimits";
import type { Language } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Small checkmark used in both plans' feature checklists — one shared glyph
// (colored per-card via `color`) instead of a plain "•" or "-", so the list
// reads as a checked-off set of included things rather than generic bullets.
function CheckIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden style={{ width: 15, height: 15, flexShrink: 0, marginTop: 2 }}>
      <circle cx="8" cy="8" r="7.25" fill="none" stroke={color} strokeWidth="1.4" />
      <path d="M4.8 8.2 L7 10.4 L11.3 5.8" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Same tinted-circle icon-in-a-badge treatment as the homepage's "How it
// works" section (app/page.tsx) — reused here so the pricing page carries
// the same visual identity instead of inventing its own icon style.
function ValuePropIcon({ tint, stroke, path }: { tint: string; stroke: string; path: ReactNode }) {
  return (
    <svg viewBox="0 0 80 80" style={{ width: 44, height: 44, marginBottom: 10 }}>
      <circle cx="40" cy="40" r="35" fill={tint} stroke={stroke} strokeWidth="2" />
      {path}
    </svg>
  );
}

/** Standalone pricing page — a signed-in visitor trades the anonymous
 * per-IP trial limit for a per-email monthly quota (see lib/account.ts).
 * The email typed here becomes the Stripe customer's email; the traveler
 * later signs in with the SAME email via the magic link on /account, which
 * is how the two get linked (see the checkout route's comment). */
export default function PricingPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);
  }, []);

  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function subscribe() {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t.account.genericError);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(typeof data?.detail === "string" ? data.detail : t.account.genericError);
      }
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Header stays 1450 (matching the rest of the site) even though this
          page's own content column below is narrower — see the comment on
          ask/page.tsx's SiteHeader call for why. */}
      <SiteHeader
        language={language}
        onLanguageChange={setLanguage}
        t={t}
        maxWidth={1450}
        contextLink={{ href: "/account", label: `${t.account.accountHeading} →` }}
      />

      <div style={{ padding: "36px clamp(32px, 8%, 180px) 0" }}>
        {/* Outer 1450 matches the header above so this page's content
            starts at the same left edge as every other page's — see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1200 }}>
          <h1 className="font-display" style={{ fontSize: "clamp(28px, 4.5vw, 38px)", fontWeight: 600, lineHeight: 1.2, margin: "0 0 8px", color: "var(--brand-teal)" }}>
            {t.account.pricingHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 32px", lineHeight: 1.5, maxWidth: 620 }}>
            {t.account.pricingSubheading}
          </p>
        </div>
        </div>
      </div>

      {/* Value props — real, already-live features (see WhyDecidePage /
          app/page.tsx's "How it works") that BOTH plans get, shown before
          the price grid so this doesn't read as two bare numbers with
          nothing behind them. */}
      <div style={{ padding: "0 clamp(32px, 8%, 180px) 40px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1200 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24 }}>
            {[
              {
                tint: "rgba(31, 111, 138, 0.1)",
                stroke: "var(--color-blue)",
                path: (
                  <g transform="translate(19, 18)">
                    <path d="M21 4 L21 34 M11 10 h20 a5 5 0 0 1 0 10 h-14 a5 5 0 0 0 0 10 h20" fill="none" stroke="var(--color-blue)" strokeWidth="2.4" strokeLinecap="round" />
                  </g>
                ),
              },
              {
                // Three stepped bars, each a different fill weight — stands
                // in for the app's confidence tiers (grounded/single-source/
                // unverified) without literally redrawing the ConfidenceDot
                // legend from the homepage.
                tint: "rgba(125, 91, 166, 0.1)",
                stroke: "var(--color-purple)",
                path: (
                  <g transform="translate(21, 19)">
                    <rect x="0" y="24" width="10" height="10" rx="2" fill="var(--color-purple)" />
                    <rect x="14" y="14" width="10" height="20" rx="2" fill="var(--color-purple)" opacity="0.55" />
                    <rect x="28" y="4" width="10" height="30" rx="2" fill="none" stroke="var(--color-purple)" strokeWidth="2" />
                  </g>
                ),
              },
              {
                tint: "rgba(232, 162, 63, 0.1)",
                stroke: "var(--accent-2)",
                path: (
                  <g transform="translate(18, 19)">
                    <path d="M4 4 h32 a2 2 0 0 1 2 2 v18 a2 2 0 0 1 -2 2 H16 l-8 8 v-8 H4 a2 2 0 0 1 -2 -2 V6 a2 2 0 0 1 2 -2 Z" fill="none" stroke="var(--accent-2)" strokeWidth="2.2" strokeLinejoin="round" />
                    <line x1="9" y1="13" x2="31" y2="13" stroke="var(--accent-2)" strokeWidth="1.6" opacity="0.6" />
                    <line x1="9" y1="19" x2="24" y2="19" stroke="var(--accent-2)" strokeWidth="1.6" opacity="0.6" />
                  </g>
                ),
              },
            ].map((v, i) => (
              <div key={i}>
                <ValuePropIcon tint={v.tint} stroke={v.stroke} path={v.path} />
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}>
                  {t.account.valueProps[i].title}
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 }}>{t.account.valueProps[i].body}</div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      <div style={{ padding: "40px clamp(32px, 8%, 180px) 64px" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1200 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            <div style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 10, padding: 26, boxShadow: "var(--shadow-panel)" }}>
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 6 }}>
                {t.account.freePlanName}
              </div>
              <div className="font-display" style={{ fontSize: 30, fontWeight: 600, marginBottom: 4 }}>
                €0
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, margin: "0 0 18px" }}>
                {t.account.freePlanBlurb.replace("{count}", String(FREE_MONTHLY_GENERATIONS))}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {t.account.freePlanFeatures.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 9 }}>
                    <CheckIcon color="var(--brand-teal)" />
                    <span style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
                      {i === 0 ? f.replace("{count}", String(FREE_MONTHLY_GENERATIONS)) : f}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                position: "relative",
                background: "var(--bg-panel)",
                border: "2px solid var(--accent-green)",
                borderRadius: 10,
                padding: 26,
                boxShadow: "var(--shadow-panel)",
              }}
            >
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-green)", marginBottom: 6 }}>
                {t.account.paidPlanName}
              </div>
              <div className="font-display" style={{ fontSize: 30, fontWeight: 600, marginBottom: 4 }}>
                {t.account.paidPlanPrice}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, margin: "0 0 14px" }}>
                {t.account.paidPlanBlurb.replace("{count}", String(PAID_MONTHLY_GENERATIONS))}
              </p>
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.04em", color: "var(--accent-green)", fontWeight: 700, marginBottom: 8 }}>
                {t.account.paidPlanFeaturesIntro}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {t.account.paidPlanFeatures.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 9 }}>
                    <CheckIcon color="var(--accent-green)" />
                    <span style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
                      {i === 0
                        ? f
                            .replace("{count}", String(PAID_MONTHLY_GENERATIONS))
                            .replace("{multiplier}", String(Math.round(PAID_MONTHLY_GENERATIONS / FREE_MONTHLY_GENERATIONS)))
                        : f}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 10 }}>
                <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 6 }}>
                  {t.account.emailLabel}
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.account.emailPlaceholder}
                  style={{
                    width: "100%",
                    background: "var(--bg-panel-raised)",
                    border: "1px solid var(--line-strong)",
                    borderRadius: 8,
                    padding: "10px 13px",
                    color: "var(--ink)",
                    fontSize: 14,
                    boxSizing: "border-box",
                    boxShadow: "inset 0 1px 3px rgba(43, 36, 28, 0.08)",
                  }}
                />
                <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6, lineHeight: 1.4 }}>
                  {t.account.emailMismatchNote}
                </div>
              </div>
              <button
                onClick={subscribe}
                disabled={submitting || !email.trim()}
                className="font-mono btn-primary"
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  fontWeight: 700,
                  fontSize: 13,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  cursor: submitting || !email.trim() ? "default" : "pointer",
                }}
              >
                {submitting ? t.account.subscribing : t.account.subscribeButton}
              </button>
              {error && (
                <div className="font-mono" style={{ fontSize: 12, color: "var(--infeasible)", marginTop: 10 }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
