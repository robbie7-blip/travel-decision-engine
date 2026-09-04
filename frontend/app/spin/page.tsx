// "Spin the wheel" - a way in for the traveler the trip form cannot help:
// the one who wants to go somewhere and has no idea where. The form asks
// for a destination in its first field, which is a dead end if you do not
// have one, and "browse 24 guides" is a research task rather than an
// answer. This makes not knowing into the fun part.
//
// The wheel only ever lands on a city with a real guide and a real
// photograph, so the result is an opening rather than a suggestion: read
// the guide, or hand the city straight to the trip form through ?dest=.
//
// Server component with a client wheel inside it, matching every other
// static page here: same two-row header, same ?lang= switching.

import type { Metadata } from "next";
import Link from "next/link";
import { AccountControl } from "@/components/AccountControl";
import { HeaderNavProvider, HeaderNavRow, HeaderNavToggle } from "@/components/HeaderNav";
import { SpinWheel } from "@/components/SpinWheel";
import { TRANSLATIONS } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";

function resolveLanguage(lang?: string): Language {
  return lang === "bg" ? "bg" : "en";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}): Promise<Metadata> {
  const { lang } = await searchParams;
  const t = TRANSLATIONS[resolveLanguage(lang)].spin;
  const title = `${t.pageTitle} - decide`;
  return {
    title,
    description: t.pageSubheading,
    openGraph: { title, description: t.pageSubheading },
    twitter: { title, description: t.pageSubheading },
  };
}

export default async function SpinPage({
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
          <HeaderNavProvider>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 14 }}>
            <Link href={`/${langSuffix}`} style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-icon.svg" alt="" width={40} height={40} style={{ flexShrink: 0 }} />
              <span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, color: "var(--logo-teal)" }}>
                decide
              </span>
            </Link>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
              <div className="header-account-group">
              <AccountControl language={language} t={t} />
              <div
                className="font-ui lang-toggle"
                style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}
              >
                <Link
                  href="/spin"
                  data-active={language === "en"}
                  style={{
                    padding: "6px 12px",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    textDecoration: "none",
                    background: "transparent",
                    color: "var(--ink-dim)",
                  }}
                >
                  EN
                </Link>
                <Link
                  href="/spin?lang=bg"
                  data-active={language === "bg"}
                  style={{
                    padding: "6px 12px",
                    fontSize: 11,
                    letterSpacing: "0.04em",
                    textDecoration: "none",
                    background: "transparent",
                    color: "var(--ink-dim)",
                  }}
                >
                  BG
                </Link>
              </div>
              <HeaderNavToggle t={t} />
              </div>
            </div>
          </div>
          <HeaderNavRow t={t} language={language} />
          </HeaderNavProvider>
        </div>
      </div>

      <div style={{ padding: "40px clamp(32px, 8%, 180px) 72px" }}>
        <div style={{ maxWidth: 1450, margin: "0 auto" }}>
          <div style={{ maxWidth: 720 }}>
            <h1
              className="font-display"
              style={{ fontSize: "clamp(28px, 4.5vw, 38px)", fontWeight: 600, lineHeight: 1.2, margin: "0 0 8px", color: "var(--ink)" }}
            >
              {t.spin.pageHeading}
            </h1>
            <p className="font-ui" style={{ fontSize: 14, color: "var(--ink-dim)", lineHeight: 1.5, margin: "0 0 32px" }}>
              {t.spin.pageSubheading}
            </p>
          </div>

          <SpinWheel t={t} language={language} />

          {/* Says how it works, because "it lands where it stops" is a
              claim and this product does not make claims it hides. */}
          <p className="font-ui" style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.5, marginTop: 28, maxWidth: 620 }}>
            {t.spin.note}
          </p>
        </div>
      </div>
    </div>
  );
}
