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
    if (params.get("error") === "invalid_link") {
      setError(TRANSLATIONS[(saved === "bg" ? "bg" : "en") as Language].account.invalidLink);
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

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Header stays 1280 (matching the rest of the site) even though this
          page's own content column below is narrower — see the comment on
          ask/page.tsx's SiteHeader call for why. */}
      <SiteHeader
        language={language}
        onLanguageChange={setLanguage}
        t={t}
        maxWidth={1280}
        contextLink={{ href: "/pricing", label: `${t.account.pricingHeading} →` }}
      />

      <div style={{ padding: "36px 24px 64px" }}>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, margin: "0 0 20px", color: "var(--brand-teal)" }}>
            {t.account.accountHeading}
          </h1>

          <div style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 8, padding: 24, boxShadow: "var(--shadow-panel)" }}>
            {account === null ? (
              <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-dim)" }}>
                ...
              </div>
            ) : account.signedIn ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, color: "var(--ink)" }}>{t.account.signedInAs.replace("{email}", account.email ?? "")}</div>
                <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                  {t.account.currentPlan.replace("{plan}", planName)}
                </div>
                {account.quota && (
                  <div className="font-mono" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                    {t.account.quotaUsed
                      .replace("{used}", String(account.quota.used))
                      .replace("{limit}", String(account.quota.limit))}
                  </div>
                )}
                {account.plan === "paid" && account.currentPeriodEnd && (
                  <div className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                    {t.account.renewsOn.replace(
                      "{date}",
                      new Date(account.currentPeriodEnd * 1000).toLocaleDateString(language === "bg" ? "bg-BG" : "en-GB")
                    )}
                  </div>
                )}
                {account.plan !== "paid" && (
                  <a
                    href="/pricing"
                    className="font-mono"
                    style={{ fontSize: 13, color: "var(--accent-green)", marginTop: 4, textDecoration: "underline" }}
                  >
                    {t.account.upgradeCta}
                  </a>
                )}
                <a
                  href="/account/visited"
                  className="font-mono"
                  style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4, textDecoration: "underline" }}
                >
                  {t.visited.navLink}
                </a>
                <button
                  onClick={signOut}
                  className="font-mono"
                  style={{
                    marginTop: 10,
                    alignSelf: "flex-start",
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
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
  );
}
