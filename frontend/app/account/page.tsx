"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { LANGUAGE_STORAGE_KEY, TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AccountState {
  signedIn: boolean;
  email?: string;
  plan?: "free" | "paid";
  currentPeriodEnd?: number | null;
  quota?: { used: number; limit: number };
}

/** Shows the signed-in visitor's plan + usage, or a sign-in box if not
 * signed in yet. Also where a magic-link click and a post-checkout Stripe
 * redirect both land (see the ?signedIn= / ?checkout= / ?error= query
 * params handled below) — one page for "start here" and "here's your
 * account" rather than splitting sign-in across a separate route. */
export default function AccountPage() {
  const [language, setLanguageState] = useState<Language>("en");
  const [account, setAccount] = useState<AccountState | null>(null);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "bg") setLanguageState(saved);

    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    const dict = TRANSLATIONS[(saved === "bg" ? "bg" : "en") as Language];
    if (errorCode === "invalid_link") {
      setError(dict.account.invalidLink);
    } else if (errorCode) {
      // Anything else (missing_token, server, ...) used to fail silently
      // here — the page would just sit on "not signed in" with no
      // indication anything had gone wrong, which is a big part of why
      // this class of bug was so hard to diagnose from the outside: a
      // real click that hit a real server error looked identical to
      // someone who'd simply never signed in. Surfacing *something* for
      // every error code means a stuck sign-in is never silent again.
      setError(dict.account.genericError);
    }

    fetch("/api/account")
      .then((r) => r.json())
      .then(setAccount)
      .catch(() => setAccount({ signedIn: false }));
  }, []);

  const t = TRANSLATIONS[language];

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  async function requestLink() {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t.account.genericError);
      return;
    }
    setSending(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : t.account.genericError);
      }
      setMessage(t.account.signInSent);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setSending(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccount({ signedIn: false });
  }

  const planName = account?.plan === "paid" ? t.account.paidPlanName : t.account.freePlanName;

  // Same teal → gold → red ramp the rest of the app already uses for
  // confidence tiers ("grounded" / "unverified" / "infeasible") — reused
  // here because it's the same underlying meaning: fine, getting close,
  // over. Aliased vars, not new colors, per the 6-color system.
  const quotaPercent = account?.quota ? Math.min(100, Math.round((account.quota.used / Math.max(account.quota.limit, 1)) * 100)) : 0;
  const quotaColor = quotaPercent >= 100 ? "var(--infeasible)" : quotaPercent >= 80 ? "var(--unverified)" : "var(--brand-teal)";

  const initial = (account?.email ?? "?").trim().charAt(0).toUpperCase() || "?";

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
        contextLink={{ href: "/pricing", label: `${t.account.pricingHeading} →` }}
      />

      <div style={{ padding: "36px clamp(32px, 8%, 180px) 64px" }}>
        {/* Outer 1450 matches the header's own width (see SiteHeader.tsx)
            so this page's content starts at the same left edge as every
            other page's, regardless of how narrow its own reading column
            is — the 560 below controls line length, not position. */}
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 700 }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 20px", color: "var(--brand-teal)" }}>
            {t.account.accountHeading}
          </h1>

          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 8, padding: 24, boxShadow: "var(--shadow-panel)" }}>
            {account === null ? (
              <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-dim)" }}>
                ...
              </div>
            ) : account.signedIn ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div className="account-avatar">{initial}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {account.email}
                    </div>
                    <div className="account-plan-badge" data-plan={account.plan === "paid" ? "paid" : "free"}>
                      {planName}
                    </div>
                  </div>
                </div>

                {account.quota && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div
                      className="font-mono"
                      style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-soft)" }}
                    >
                      <span>
                        {t.account.quotaUsed
                          .replace("{used}", String(account.quota.used))
                          .replace("{limit}", String(account.quota.limit))}
                      </span>
                    </div>
                    <div className="account-progress-track">
                      <div className="account-progress-fill" style={{ width: `${quotaPercent}%`, background: quotaColor }} />
                    </div>
                    {account.plan === "paid" && account.currentPeriodEnd && (
                      <div className="font-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>
                        {t.account.renewsOn.replace(
                          "{date}",
                          new Date(account.currentPeriodEnd * 1000).toLocaleDateString(language === "bg" ? "bg-BG" : "en-GB")
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {account.plan !== "paid" && (
                    <a href="/pricing" className="account-row account-upgrade-row">
                      <span style={{ fontWeight: 600, color: "var(--accent-green)" }}>{t.account.upgradeCta.replace(" →", "")}</span>
                      <span className="account-row-arrow">→</span>
                    </a>
                  )}
                  <a href="/account/visited" className="account-row">
                    <span>{t.visited.navLink.replace(" →", "")}</span>
                    <span className="account-row-arrow">→</span>
                  </a>
                </div>

                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <button
                    onClick={signOut}
                    className="font-mono"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--line)",
                      borderRadius: 999,
                      padding: "6px 14px",
                      fontSize: 12,
                      color: "var(--ink-soft)",
                      cursor: "pointer",
                    }}
                  >
                    {t.account.signOutButton}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="account-avatar" style={{ background: "var(--bg-panel-raised)", color: "var(--ink-dim)", marginBottom: 4 }}>
                  ?
                </div>
                <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-dim)" }}>
                  {t.account.notSignedIn}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.account.emailPlaceholder}
                    style={{
                      flex: 1,
                      minWidth: 200,
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
                  <button
                    onClick={requestLink}
                    disabled={sending || !email.trim()}
                    className="font-mono btn-primary"
                    style={{
                      padding: "10px 16px",
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      cursor: sending || !email.trim() ? "default" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {t.account.signInButton}
                  </button>
                </div>
                {message && (
                  <div className="font-mono" style={{ fontSize: 12, color: "var(--accent-green)" }}>
                    {message}
                  </div>
                )}
              </div>
            )}
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
