"use client";

// Global "Sign in" / "Account" entry point, rendered next to the language
// toggle in every header (SiteHeader.tsx, plus the three hand-rolled
// headers on destinations/destinations/[slug]/showcase which don't use
// SiteHeader). Before this, sign-in only existed as UI buried inside
// /account and /account/visited themselves — there was no visible way to
// reach it from anywhere else, even though several pages (visited-places
// sync, saved plan/quota) are meaningfully better once signed in. This is
// deliberately just a link to /account, not an inline login form — /account
// already owns the full email/magic-link flow, so this stays a single
// small pill instead of duplicating that UI in the header.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function AccountControl({ language, t }: { language: Language; t: Dictionary }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((data) => setSignedIn(Boolean(data?.signedIn)))
      .catch(() => setSignedIn(false));
  }, []);

  const langSuffix = language === "bg" ? "?lang=bg" : "";

  return (
    <Link
      href={`/account${langSuffix}`}
      className="font-ui account-control"
      data-signed-in={signedIn}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--line)",
        borderRadius: 999,
        padding: "6px 12px",
        fontSize: 11,
        letterSpacing: "0.04em",
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {signedIn && <span className="account-control-dot" aria-hidden />}
      {signedIn ? t.account.headerAccountLink : t.account.headerSignIn}
    </Link>
  );
}
