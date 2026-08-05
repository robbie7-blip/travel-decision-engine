"use client";

import { useEffect, useState } from "react";
import { LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { FREE_MONTHLY_GENERATIONS, PAID_MONTHLY_GENERATIONS } from "@/lib/planLimits";
import type { Language } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
            <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--grounded)" }}>
              decide
            </span>
          </a>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginLeft: "auto" }}>
            <a href="/account" className="font-mono" style={{ fontSize: 12, letterSpacing: "0.04em", color: "var(--ink-soft)", textDecoration: "none" }}>
              {t.account.accountHeading} →
            </a>
            <div className="nav-divider" style={{ width: 1, height: 18, background: "var(--line)" }} />
            <div className="font-mono" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
              {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  style={{
                    border: "none",
                    padding: "6px 12px",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    background: language === lang ? "var(--accent-green)" : "transparent",
                    color: language === lang ? "var(--bg-panel)" : "var(--ink-dim)",
                  }}
                >
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>
            {t.account.pricingHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 28px", lineHeight: 1.5, maxWidth: 560 }}>
            {t.account.pricingSubheading}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 28 }}>
            <div style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 8, padding: 20, boxShadow: "var(--shadow-panel)" }}>
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 6 }}>
                {t.account.freePlanName}
              </div>
              <div className="font-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>
                €0
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, margin: 0 }}>
                {t.account.freePlanBlurb.replace("{count}", String(FREE_MONTHLY_GENERATIONS))}
              </p>
            </div>
            <div
              style={{
                background: "var(--bg-panel)",
                border: "2px solid var(--accent-green)",
                borderRadius: 8,
                padding: 20,
                boxShadow: "var(--shadow-panel)",
              }}
            >
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-green)", marginBottom: 6 }}>
                {t.account.paidPlanName}
              </div>
              <div className="font-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>
                {t.account.paidPlanPrice}
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, margin: "0 0 16px" }}>
                {t.account.paidPlanBlurb.replace("{count}", String(PAID_MONTHLY_GENERATIONS))}
              </p>
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
  );
}
