// Privacy Policy — English-only, same reasoning as /terms (see that file's
// top-of-file comment): a mistranslated legal document is worse than none.
// Every claim below is grounded in what the codebase actually does — see
// lib/account.ts (Redis user records), lib/jobs.ts (30-day job TTL),
// lib/account.ts's QUOTA_KEY_TTL_SECONDS (~40 days), lib/analytics.ts
// (aggregate-only, no per-user tracking), lib/session.ts (the one cookie
// this app sets), and app/api/trip-questions/route.ts (Anthropic web_search
// for Pro) — not generic privacy-policy boilerplate.

import type { Metadata } from "next";
import Link from "next/link";
import { AccountControl } from "@/components/AccountControl";
import { NavMenu } from "@/components/NavMenu";
import { LegalSection } from "@/components/ui";
import { TRANSLATIONS } from "@/lib/i18n";
import { OPERATOR_NAME, CONTACT_EMAIL } from "@/lib/legal";
import type { Language } from "@/lib/types";

const LAST_UPDATED = "10 August 2026";

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Privacy Policy — decide";
  const description = "What decide collects, why, and how it's used.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

interface DataRow {
  what: string;
  why: string;
}

const DATA_COLLECTED: DataRow[] = [
  {
    what: "Email address",
    why: "If you sign in (magic link) or subscribe to Pro — identifies your account, sends sign-in links, and links your Stripe subscription to your account.",
  },
  {
    what: "Trip details you type in",
    why: "Destinations, dates, budget, party size/description, interests, and any constraints — sent to Anthropic (maker of the Claude model that powers generation) to produce your itinerary.",
  },
  {
    what: "Ask a Local questions",
    why: "Sent to Anthropic to generate an answer. On a Pro account, a question may also trigger a live web search (via Anthropic's search tool) when it needs current information.",
  },
  {
    what: "Photos you attach to a question (Pro)",
    why: "Sent to Anthropic to answer the question about them, and never stored by decide — not on our servers, not in our database. They exist for the length of that one request and then they're gone. They stay visible in your browser for the rest of that conversation only, and disappear when you reload or leave the page. Photos in this context are often of hotel rooms, menus, receipts or documents, so avoid including anything you wouldn't want read by a third-party AI provider — passports, boarding passes, card numbers.",
  },
  {
    what: "Visited-countries data",
    why: "If you use that feature: stored against your email if you're signed in, or only in your own browser's local storage if you're not.",
  },
  {
    what: "IP address",
    why: "Used briefly, and only, to apply anonymous rate limits that prevent abuse. Not linked to your account or stored long-term.",
  },
  {
    what: "Payment information",
    why: "Handled entirely by Stripe. decide never receives or stores your card number — only your email, a Stripe customer ID, and your subscription status.",
  },
  {
    what: "Aggregate usage counts",
    why: "E.g. how many trips were generated per day, per language. Not tied to any individual visitor — used only for our own internal stats.",
  },
];

export default async function PrivacyPage({
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
                <Link href="/privacy" data-active={language === "en"} style={{ padding: "6px 12px", fontSize: 11, letterSpacing: "0.04em", textDecoration: "none", background: "transparent", color: "var(--ink-dim)" }}>
                  EN
                </Link>
                <Link href="/privacy?lang=bg" data-active={language === "bg"} style={{ padding: "6px 12px", fontSize: 11, letterSpacing: "0.04em", textDecoration: "none", background: "transparent", color: "var(--ink-dim)" }}>
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
            Privacy Policy
          </h1>
          <p className="font-mono" style={{ fontSize: 12, color: "var(--ink-dim)", margin: "0 0 8px" }}>
            Last updated: {LAST_UPDATED}
          </p>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 36px", fontStyle: "italic" }}>
            English only, for the same reason as the Terms of Service — see that page.
          </p>

          <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink-soft)", marginBottom: 28 }}>
            This describes what decide (the "Service"), operated by {OPERATOR_NAME}, collects, why, and how it&apos;s
            used. We don&apos;t sell your data, and we don&apos;t use third-party advertising or tracking cookies —
            the only cookie decide sets is a session cookie used solely to keep you signed in.
          </p>

          <LegalSection heading="What we collect">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {DATA_COLLECTED.map((row) => (
                <div key={row.what}>
                  <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>{row.what}</div>
                  <div>{row.why}</div>
                </div>
              ))}
            </div>
          </LegalSection>

          <LegalSection heading="Where it's stored">
            <p style={{ margin: 0 }}>
              Upstash Redis — a hosted database. There&apos;s no separate customer database beyond that.
            </p>
          </LegalSection>

          <LegalSection heading="Who we share it with">
            <p style={{ margin: "0 0 10px" }}>
              <strong style={{ color: "var(--ink)" }}>Anthropic</strong> — trip details and questions, to generate
              itineraries and answers.
              <br />
              <strong style={{ color: "var(--ink)" }}>Stripe</strong> — your email and billing details, to process
              subscription payments.
              <br />
              <strong style={{ color: "var(--ink)" }}>Resend</strong> — your email address, to deliver sign-in links.
            </p>
            <p style={{ margin: 0 }}>
              Depending on what&apos;s configured on a given deployment, Google Places, Amadeus, and Open-Meteo may
              also be queried for destination, venue, flight, or weather information — these receive search terms
              about places, not information that identifies you personally.
            </p>
          </LegalSection>

          <LegalSection heading="How long we keep it">
            <p style={{ margin: 0 }}>
              Generated trip records: 30 days. Usage/quota counters: roughly 40 days. Account and subscription
              records, and visited-countries data (if you&apos;re signed in): kept for as long as your account
              exists.
            </p>
          </LegalSection>

          <LegalSection heading="Your rights">
            <p style={{ margin: "0 0 10px" }}>
              You can request a copy of your data, ask us to correct it, or ask us to delete your account and
              associated data at any time by emailing {CONTACT_EMAIL}. If you&apos;re in the EU/UK, this includes
              your rights under GDPR — access, rectification, erasure, portability, and objection.
            </p>
            <p style={{ margin: 0 }}>
              We don&apos;t currently offer a self-service "delete my account" button in the app — deletion
              requests are handled manually once we receive your email.
            </p>
          </LegalSection>

          <LegalSection heading="Children">
            <p style={{ margin: 0 }}>
              decide isn&apos;t directed at children, and we don&apos;t knowingly collect data from anyone under 16.
            </p>
          </LegalSection>

          <LegalSection heading="Changes">
            <p style={{ margin: 0 }}>
              We may update this policy from time to time; the "Last updated" date above will change when we do.
            </p>
          </LegalSection>

          <LegalSection heading="Contact">
            <p style={{ margin: 0 }}>
              Questions about this policy, or to exercise your rights above: {CONTACT_EMAIL}.
            </p>
          </LegalSection>
        </div>
        </div>
      </div>
    </div>
  );
}
