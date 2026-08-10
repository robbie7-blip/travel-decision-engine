// Terms of Service — English-only (unlike the rest of the site) because
// getting legal-document translation wrong is a worse outcome than not
// having it: the EN text here is what actually governs, and a mistranslated
// BG version could read as a different, conflicting agreement. The header
// still supports the EN/BG toggle for site navigation — it just doesn't
// change this page's body.
//
// LAST_UPDATED and the two placeholders below (operator name, contact
// email) need filling in with real values before this is truly ready to
// govern a live, paying customer base — see the chat message that shipped
// this file for the full list of what's still a placeholder.

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AccountControl } from "@/components/AccountControl";
import { NavMenu } from "@/components/NavMenu";
import { TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

const LAST_UPDATED = "10 August 2026";
// TODO: replace with your real legal/business name and a monitored inbox
// before going live — see this page's top-of-file comment.
const OPERATOR_NAME = "[operator name — replace before launch]";
const CONTACT_EMAIL = "[support email — replace before launch]";

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Terms of Service — decide";
  const description = "The terms that govern using decide.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 className="font-display" style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px", color: "var(--ink)" }}>
        {heading}
      </h2>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)" }}>{children}</div>
    </div>
  );
}

export default async function TermsPage({
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
                <Link href="/terms" data-active={language === "en"} style={{ padding: "6px 12px", fontSize: 11, letterSpacing: "0.04em", textDecoration: "none", background: "transparent", color: "var(--ink-dim)" }}>
                  EN
                </Link>
                <Link href="/terms?lang=bg" data-active={language === "bg"} style={{ padding: "6px 12px", fontSize: 11, letterSpacing: "0.04em", textDecoration: "none", background: "transparent", color: "var(--ink-dim)" }}>
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
            Terms of Service
          </h1>
          <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 8px" }}>
            Last updated: {LAST_UPDATED}
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 36px", fontStyle: "italic" }}>
            English only — this is the version that governs your use of decide, regardless of which language you
            browse the rest of the site in.
          </p>

          <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)", marginBottom: 28 }}>
            These Terms of Service ("Terms") govern your use of decide (the "Service"), operated by {OPERATOR_NAME}.
            By creating an account, generating a trip, or subscribing to a paid plan, you agree to these Terms. If
            you don&apos;t agree, don&apos;t use the Service.
          </p>

          <Section heading="1. What decide is — and isn't">
            <p style={{ margin: "0 0 10px" }}>
              decide is an AI-assisted trip-planning tool. It generates itinerary suggestions, checks live prices
              where it can, and answers general travel questions ("Ask a Local").
            </p>
            <p style={{ margin: 0 }}>
              decide is not a travel agency, booking service, or licensed advisor. It does not book flights, hotels,
              or activities on your behalf, and nothing it outputs is professional travel, medical, legal, safety, or
              financial advice. You make your own bookings and your own decisions.
            </p>
          </Section>

          <Section heading="2. Accuracy — read this before you rely on anything">
            <p style={{ margin: "0 0 10px" }}>
              Every recommendation carries a confidence label (verified, fact-grounded, single-source, conflicting,
              or an honest guess) showing how it was checked — this is a real, load-bearing part of the product, not
              a disclaimer for its own sake. Even a "verified" result can be wrong, out of date, or change after it
              was checked.
            </p>
            <p style={{ margin: 0 }}>
              Always independently confirm anything time-sensitive or safety-critical — prices, opening hours,
              availability, travel advisories, visa/entry requirements — before you act on it, book anything, or
              travel. decide is a research aid, not a source of truth.
            </p>
          </Section>

          <Section heading="3. Accounts">
            <p style={{ margin: 0 }}>
              Signing in uses a passwordless "magic link" sent to your email — there's no separate password to
              manage. Anyone with access to that email inbox can access your account, so keep it secure. You&apos;re
              responsible for all activity under your account.
            </p>
          </Section>

          <Section heading="4. Subscriptions and billing">
            <p style={{ margin: "0 0 10px" }}>
              The Pro plan is a recurring monthly subscription, billed through Stripe, that renews automatically
              until cancelled. decide never sees or stores your card number — Stripe handles payment collection
              directly.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              To cancel, email {CONTACT_EMAIL} and we&apos;ll cancel it for you — you&apos;ll keep Pro access
              through the end of the billing period you already paid for. We don&apos;t currently offer a
              self-service cancellation button in the app itself.
            </p>
            <p style={{ margin: 0 }}>
              We don&apos;t offer refunds for partial billing periods, except where required by law. If you&apos;re
              an EU consumer: digital subscription access begins immediately upon payment at your request, which
              under EU consumer law means the standard 14-day right of withdrawal doesn&apos;t apply once the
              service has started.
            </p>
          </Section>

          <Section heading="5. Free and Pro plan limits">
            <p style={{ margin: 0 }}>
              Both plans include a monthly cap on full itinerary generations (see the current numbers on the
              Pricing page) and unlimited Ask a Local questions. We may change these limits going forward.
            </p>
          </Section>

          <Section heading="6. Acceptable use">
            <p style={{ margin: 0 }}>
              Don&apos;t use decide to break the law, attempt to bypass rate limits or quotas, scrape or
              automate requests at abusive scale, or submit content that&apos;s illegal, harmful, or infringes
              someone else&apos;s rights. We can suspend or terminate access for violating this.
            </p>
          </Section>

          <Section heading="7. Service availability">
            <p style={{ margin: 0 }}>
              decide depends on third-party services — AI models, live web search, weather, flight, and venue data
              providers — that can be slow, temporarily unavailable, or occasionally wrong. We don&apos;t guarantee
              uninterrupted availability or that any particular piece of information will be accurate.
            </p>
          </Section>

          <Section heading="8. Limitation of liability">
            <p style={{ margin: 0 }}>
              The Service is provided "as is," without warranties of any kind. To the maximum extent permitted by
              law, {OPERATOR_NAME} isn&apos;t liable for losses, costs, or damages arising from travel decisions
              made using information from the Service — including inaccurate, outdated, or incomplete information —
              or from Service downtime or unavailability.
            </p>
          </Section>

          <Section heading="9. Changes">
            <p style={{ margin: 0 }}>
              We may update these Terms or the Service itself from time to time. Continuing to use decide after a
              change means you accept the update. Material changes will update the "Last updated" date above.
            </p>
          </Section>

          <Section heading="10. Contact">
            <p style={{ margin: 0 }}>
              Questions about these Terms: {CONTACT_EMAIL}.
            </p>
          </Section>
        </div>
        </div>
      </div>
    </div>
  );
}
