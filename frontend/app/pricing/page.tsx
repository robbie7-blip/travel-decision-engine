"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import { ANNUAL_PRICE, FREE_MONTHLY_GENERATIONS, PAID_MONTHLY_GENERATIONS, TRIP_PASS_PRICE } from "@/lib/planLimits";
import type { Language } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What the checkout route sells (app/api/checkout). */
type CheckoutPlan = "trip_pass" | "annual";

// Small checkmark used in both plans' feature checklists - one shared glyph
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

/** One plan: its name, price, what it includes, and a buy button for the
 * paid ones. The highlighted card is the one most people should pick. */
function PlanCard(props: {
  name: string;
  price: string;
  per?: string;
  blurb: string;
  featuresIntro?: string;
  features: string[];
  color: string;
  highlight?: boolean;
  action?: { label: string; onClick: () => void; disabled: boolean };
  error?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        border: props.highlight ? `2px solid ${props.color}` : "1px solid var(--line)",
        borderRadius: 10,
        padding: 26,
        boxShadow: "var(--shadow-panel)",
      }}
    >
      <div className="font-ui" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: props.highlight ? props.color : "var(--ink-dim)", marginBottom: 6 }}>
        {props.name}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span className="font-display" style={{ fontSize: 30, fontWeight: 600 }}>
          {props.price}
        </span>
        {props.per && <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>{props.per}</span>}
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, margin: "0 0 16px" }}>{props.blurb}</p>
      {props.featuresIntro && (
        <div className="font-ui" style={{ fontSize: 11, letterSpacing: "0.04em", color: props.color, fontWeight: 700, marginBottom: 8 }}>
          {props.featuresIntro}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: props.action ? 20 : 0 }}>
        {props.features.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 9 }}>
            <CheckIcon color={props.color} />
            <span style={{ fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>{f}</span>
          </div>
        ))}
      </div>
      {props.action && (
        <div style={{ marginTop: "auto" }}>
          <button
            type="button"
            onClick={props.action.onClick}
            disabled={props.action.disabled}
            className={props.highlight ? "font-ui btn-primary" : "font-ui"}
            style={{
              width: "100%",
              minHeight: 44,
              padding: "12px 16px",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: props.action.disabled ? "default" : "pointer",
              ...(props.highlight ? {} : { background: "transparent", color: "var(--ink)", border: "1px solid var(--line-strong)", borderRadius: 8 }),
            }}
          >
            {props.action.label}
          </button>
          {props.error && (
            <div role="alert" className="font-ui" style={{ fontSize: 12, color: "var(--infeasible)", marginTop: 10 }}>
              {props.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The tinted-circle icon badges that used to live here are gone. They
// were a deliberate copy of the homepage's "How it works" treatment, so
// when that became three numbered columns divided by rules, this became
// the last place on the site still drawing icons inside circles - the
// exact motif the redesign set out to remove. It now reuses .step-rows,
// the same class the homepage uses, so the two cannot drift again.

/** Standalone pricing page - a signed-in visitor trades the anonymous
 * per-IP trial limit for a per-email monthly quota (see lib/account.ts).
 * The email typed here becomes the Stripe customer's email; the traveler
 * later signs in with the SAME email via the magic link on /account, which
 * is how the two get linked (see the checkout route's comment). */
export default function PricingPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState<CheckoutPlan | null>(null);
  const [error, setError] = useState<{ plan: CheckoutPlan; message: string } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);

    // Funnel visibility (see lib/analytics.ts) - the one event with no
    // server route to piggyback on, since this page has no server-side
    // render step to hook into. Fire-and-forget: a dropped pageview count
    // must never block or visibly affect the actual page.
    fetch("/api/analytics/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pricing_view" }),
    }).catch(() => {});
  }, []);

  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function buy(plan: CheckoutPlan) {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError({ plan, message: t.account.emailFirst });
      emailRef.current?.focus();
      return;
    }
    setSubmitting(plan);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, plan }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(typeof data?.detail === "string" ? data.detail : t.account.genericError);
      }
      window.location.href = data.url;
    } catch (e) {
      setError({ plan, message: e instanceof Error ? e.message : t.account.genericError });
      setSubmitting(null);
    }
  }

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Header stays 1450 (matching the rest of the site) even though this
          page's own content column below is narrower - see the comment on
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
            starts at the same left edge as every other page's - see the
            same fix on account/page.tsx. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1200 }}>
          <h1 className="font-display" style={{ fontSize: "clamp(28px, 4.5vw, 38px)", fontWeight: 600, lineHeight: 1.2, margin: "0 0 8px", color: "var(--ink)" }}>
            {t.account.pricingHeading}
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-dim)", margin: "0 0 32px", lineHeight: 1.5, maxWidth: 620 }}>
            {t.account.pricingSubheading}
          </p>
        </div>
        </div>
      </div>

      {/* Value props - real, already-live features (see WhyDecidePage /
          app/page.tsx's "How it works") that BOTH plans get, shown before
          the price grid so this doesn't read as two bare numbers with
          nothing behind them. */}
      <div style={{ padding: "0 clamp(32px, 8%, 180px) 40px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1200 }}>
          <div className="step-rows">
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
                // Three stepped bars, each a different fill weight - stands
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
            ].map((_, i) => (
              <div key={i} className="step-row">
                <div className="font-display" style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div className="font-display" style={{ fontSize: 19, fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>
                  {t.account.valueProps[i].title}
                </div>
                <div style={{ fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6 }}>{t.account.valueProps[i].body}</div>
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>

      <div style={{ padding: "40px clamp(32px, 8%, 180px) 64px" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 1200 }}>
          {/* min(300px, 100%), not a bare 300px, and this is the reference
              copy of a fix applied to five other grids in this codebase.

              minmax(300px, 1fr) is a FLOOR, not a preference: auto-fit
              drops to one column but that column is still at least 300px
              wide, whatever the container is. This section keeps 32px of
              padding on each side, so on a 320px screen the container is
              256px and the plan cards were laid out 300px wide anyway -
              44px past their box, 12px past the screen, which gave the
              whole page a horizontal scrollbar. Measured at 320: 12px of
              overflow before, none after. At 360 the same cards spilled
              4px into the right padding, so the card edge sat closer to
              the screen edge than the left one did.

              min(300px, 100%) resolves to 300px whenever there is room for
              it and to the container's width when there is not, so the
              floor never exceeds the box. Nothing changes at or above
              364px, where 300px fits. */}
          <div style={{ maxWidth: 520, marginBottom: 24 }}>
            <label htmlFor="pricing-email" className="font-ui" style={{ display: "block", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-dim)", marginBottom: 6 }}>
              {t.account.emailLabel}
            </label>
            <input
              id="pricing-email"
              ref={emailRef}
              type="email"
              autoComplete="email"
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
            <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 6, lineHeight: 1.4 }}>
              {t.account.emailMismatchNote}
            </div>
          </div>
          {/* min(280px, 100%), not a bare 280px: the floor must never be
              wider than the box, or a 320px phone scrolls sideways (the
              reasoning is on the same fix in five other grids). */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20, alignItems: "stretch" }}>
            <PlanCard
              name={t.account.freePlanName}
              price="€0"
              blurb={t.account.freePlanBlurb}
              features={t.account.freePlanFeatures.map((f) => f.replace("{count}", String(FREE_MONTHLY_GENERATIONS)))}
              color="var(--brand-teal)"
            />
            <PlanCard
              name={t.account.tripPassName}
              price={TRIP_PASS_PRICE[language]}
              per={t.account.tripPassPer}
              blurb={t.account.tripPassBlurb}
              features={t.account.tripPassFeatures}
              color="var(--accent-2)"
              action={{ label: submitting === "trip_pass" ? t.account.subscribing : t.account.tripPassButton, onClick: () => void buy("trip_pass"), disabled: submitting !== null }}
              error={error?.plan === "trip_pass" ? error.message : ""}
            />
            <PlanCard
              highlight
              name={t.account.paidPlanName}
              price={ANNUAL_PRICE[language]}
              per={t.account.paidPlanPer}
              blurb={t.account.paidPlanBlurb.replace("{count}", String(PAID_MONTHLY_GENERATIONS))}
              featuresIntro={t.account.paidPlanFeaturesIntro}
              features={t.account.paidPlanFeatures.map((f) => f.replace("{count}", String(PAID_MONTHLY_GENERATIONS)))}
              color="var(--accent-green)"
              action={{ label: submitting === "annual" ? t.account.subscribing : t.account.paidPlanButton, onClick: () => void buy("annual"), disabled: submitting !== null }}
              error={error?.plan === "annual" ? error.message : ""}
            />
          </div>
          {/* Right at the point money changes hands - the one place on
              the site these links genuinely need to be, not buried in a
              footer no one scrolls to before paying. */}
          <div className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 16, lineHeight: 1.5 }}>
            {language === "bg" ? "С покупка приемаш нашите " : "By buying, you agree to our "}
            <Link href="/terms" style={{ color: "var(--ink-dim)" }}>
              {language === "bg" ? "Общи условия" : "Terms"}
            </Link>
            {language === "bg" ? " и " : " and "}
            <Link href="/privacy" style={{ color: "var(--ink-dim)" }}>
              {language === "bg" ? "Политика за поверителност" : "Privacy Policy"}
            </Link>
            .
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
