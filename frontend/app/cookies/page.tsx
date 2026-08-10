// Cookie Policy — the third leg of the standard Terms/Privacy/Cookies
// footer trio (see SiteFooter.tsx). Kept intentionally short: decide sets
// exactly one cookie (see lib/session.ts), and it's a strictly necessary
// one (keeps you signed in), not an analytics/advertising/tracking cookie
// — under GDPR/ePrivacy that means it's exempt from needing a consent
// banner, which is why this site doesn't have one. This page exists to
// disclose that plainly rather than to gate anything.

import type { Metadata } from "next";
import Link from "next/link";
import { AccountControl } from "@/components/AccountControl";
import { NavMenu } from "@/components/NavMenu";
import { LegalSection } from "@/components/ui";
import { TRANSLATIONS } from "@/lib/i18n";
import { CONTACT_EMAIL } from "@/lib/legal";
import type { Language } from "@/lib/types";

const LAST_UPDATED = "10 August 2026";

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Cookie Policy — decide";
  const description = "The one cookie decide sets, and why.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

export default async function CookiesPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const language = resolveLanguage(lang);
  const t = TRANSLATIONS[language];
  const langSuffix = language === "bg" ? "?lang=bg" : "";

  return (
    <div style={{ minHeight: "100%" }}>
      <div style={{ padding: "18px clamp(32px, 8%, 180px) 0", background: "var(--bg-panel-raised)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 14 }}>
            <Link href={`/${langSuffix}`} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
              <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
                decide
              </span>
            </Link>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <AccountControl language={language} t={t} />
              <div className="font-mono lang-toggle" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}>
                <Link href="/cookies" data-active={language === "en"} style={{ padding: "6px 12px", fontSize: 11, letterSpacing: "0.04em", textDecoration: "none", background: "transparent", color: "var(--ink-dim)" }}>
                  EN
                </Link>
                <Link href="/cookies?lang=bg" data-active={language === "bg"} style={{ padding: "6px 12px", fontSize: 11, letterSpacing: "0.04em", textDecoration: "none", background: "transparent", color: "var(--ink-dim)" }}>
                  BG
                </Link>
              </div>
            </div>
          </div>
          <div className="header-nav-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <NavMenu t={t} language={language} />
          </div>
        </div>
      </div>

      <div style={{ padding: "40px clamp(32px, 8%, 180px) 72px" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
        <div style={{ maxWidth: 760 }}>
          <h1 className="font-display" style={{ fontSize: "clamp(28px, 4.5vw, 38px)", fontWeight: 600, lineHeight: 1.2, margin: "0 0 6px", color: "var(--brand-teal)" }}>
            Cookie Policy
          </h1>
          <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 8px" }}>
            Last updated: {LAST_UPDATED}
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 36px", fontStyle: "italic" }}>
            English only, for the same reason as the Terms of Service — see that page.
          </p>

          <LegalSection heading="The one cookie decide sets">
            <p style={{ margin: "0 0 10px" }}>
              decide sets a single cookie, <code>decide_session</code>. It exists only to keep you signed in between
              visits — it stores a signed token identifying your account, nothing else. It&apos;s marked httpOnly
              and secure, so it can&apos;t be read by page scripts or sent over an unencrypted connection.
            </p>
            <p style={{ margin: 0 }}>
              This cookie is strictly necessary for the sign-in feature to work at all — it&apos;s only set once you
              actually sign in, and it&apos;s not used for advertising, analytics, or tracking you across sites.
              Under GDPR/ePrivacy rules, strictly-necessary cookies like this one are exempt from requiring consent,
              which is why decide doesn&apos;t show a cookie-consent banner.
            </p>
          </LegalSection>

          <LegalSection heading="What decide doesn't do">
            <p style={{ margin: 0 }}>
              No third-party advertising or analytics cookies, no cross-site tracking pixels, no fingerprinting.
              Our own usage stats (how many trips were generated, per day/language) are plain aggregate counters
              with no cookie and nothing tied to you individually — see the Privacy Policy for details.
            </p>
          </LegalSection>

          <LegalSection heading="Other storage">
            <p style={{ margin: 0 }}>
              A few features use your browser&apos;s local storage instead of a cookie — your language preference,
              your currency preference, your recently-viewed trips, and (if you&apos;re not signed in) any countries
              you&apos;ve marked as visited. None of this is sent to us automatically; it just lives in your own
              browser until you clear it.
            </p>
          </LegalSection>

          <LegalSection heading="Questions">
            <p style={{ margin: 0 }}>{CONTACT_EMAIL}</p>
          </LegalSection>
        </div>
        </div>
      </div>
    </div>
  );
}
